import { describe, expect, it } from 'vitest'
import { chunkSourceDoc } from '../chunking/chunk-source-doc'
import { isTranscript, timestampLabel } from '../chunking/transcript'
import { sha256Hex } from '../hash'
import type { WhisperSegment } from '../sidecars/whisper'
import type { Block, SourceDoc } from '../source-doc'
import {
  byTime,
  FUSION_BUCKET_SECONDS,
  fuseSaidAndShown,
  MAX_FRAME_TEXT_CHARS,
  transcriptBlocks,
} from './blocks'

/**
 * The one-field contract this module has with sub-phase 6.2 (`docs/spec/05-ingestion-rag.md`
 * §1, "merge of 'what it says + what it shows'"), asserted from the consumer's side.
 *
 * `chunkTranscript` reads exactly one thing off a block — `locator.timeSec` — and from it
 * derives where each 60–90 s window closes, the citation label, and the `t_start`/`t_end` of
 * every `source_units` row. So the mistakes available here are all invisible locally and loud
 * downstream: merging segments early costs the chunker the pause it cuts at, dropping the
 * part offset puts a course's second lecture back at minute zero, and describing every
 * keyframe multiplies a lecture's blocks by an order of magnitude. Each is pinned directly
 * rather than inferred from the shape of the output.
 *
 * The last test builds a `SourceDoc` out of this module's own blocks and runs the real
 * chunker over it, because "6.2 can consume what 6.4 produced" is the one claim here that no
 * unit assertion can make on its own.
 */

/** Ids as `ParseContext` hands them over: dense, in call order, so a skipped block shows up
 *  as a gap that never happened. */
function ids(prefix: string): () => string {
  let next = 0
  return () => {
    next += 1
    return `${prefix}-${next}`
  }
}

/** `endSec` is never read: 6.2 re-derives a segment's duration from its own text length, so
 *  the value here only has to be plausible. */
function seg(startSec: number, text: string): WhisperSegment {
  return { startSec, endSec: startSec + 10, text }
}

/** ~15 characters of speech per second, the rate `chunking/transcript.ts` assumes. */
function spoken(seconds: number): string {
  const chars = Math.round(seconds * 15)
  let text = ''
  for (let index = 0; text.length < chars; index += 1) text += `palabra${index % 10} `
  return text.slice(0, chars).trim()
}

function block(id: string, timeSec?: number): Block {
  return {
    id,
    type: 'paragraph',
    text: id,
    locator: timeSec === undefined ? {} : { timeSec },
    hash: sha256Hex(id),
  }
}

describe('transcriptBlocks', () => {
  it('emits one block per whisper segment even when they all fit in a single window', () => {
    const blocks = transcriptBlocks({
      segments: [seg(0, 'uno'), seg(12, 'dos'), seg(24, 'tres')],
      offsetSec: 0,
      id: ids('b'),
    })

    // Thirty seconds of speech is half of 6.2's smallest window, so merging here would be
    // free — and would throw away the only boundary signal the chunker has, the silence
    // between two segments.
    expect(blocks.map((entry) => entry.text)).toEqual(['uno', 'dos', 'tres'])
    expect(blocks.map((entry) => entry.locator.timeSec)).toEqual([0, 12, 24])
    expect(blocks.every((entry) => entry.type === 'paragraph')).toBe(true)
  })

  it("lands a course's second lecture on the global timeline, not back at zero", () => {
    const blocks = transcriptBlocks({
      segments: [seg(0, 'primera frase'), seg(30, 'segunda frase')],
      offsetSec: 1_800,
      id: ids('b'),
    })

    // Whisper counts from the start of the file it was handed; the part offset is what turns
    // that into a position in the course, and it is the only place the two can be joined.
    expect(blocks.map((entry) => entry.locator.timeSec)).toEqual([1_800, 1_830])
  })

  it('keeps a fractional segment time exactly as whisper reported it', () => {
    const blocks = transcriptBlocks({
      segments: [seg(12.34, 'texto')],
      offsetSec: 60.5,
      id: ids('b'),
    })

    expect(blocks[0]?.locator.timeSec).toBeCloseTo(72.84, 6)
  })

  it('skips a blank cue without spending an id on it', () => {
    const blocks = transcriptBlocks({
      segments: [
        seg(0, 'primero'),
        seg(5, '   '),
        seg(10, ''),
        seg(15, '\n\t'),
        seg(20, 'segundo'),
      ],
      offsetSec: 0,
      id: ids('b'),
    })

    // A silent stretch is not a citation: 6.2's normaliser would drop the empty text but the
    // part's section would still list the block's id, leaving a reference that resolves to
    // nothing at all.
    expect(blocks.map((entry) => entry.text)).toEqual(['primero', 'segundo'])
    expect(blocks.map((entry) => entry.id)).toEqual(['b-1', 'b-2'])
  })

  it('hashes the trimmed text the block actually carries', () => {
    const blocks = transcriptBlocks({
      segments: [seg(0, '  con espacios  ')],
      offsetSec: 0,
      id: ids('b'),
    })

    expect(blocks[0]?.text).toBe('con espacios')
    expect(blocks[0]?.hash).toBe(sha256Hex('con espacios'))
  })

  it('applies the glossary before hashing, so a corrected transcript re-runs identically', () => {
    const glossary = (text: string): string => text.replace(/fs\s*rs/gi, 'FSRS')
    const first = transcriptBlocks({
      segments: [seg(0, ' el algoritmo fs rs ')],
      offsetSec: 0,
      id: ids('b'),
      glossary,
    })
    // The glossary is a fixed point on its own output, so feeding the corrected text back in
    // is what a re-parse of the same recording looks like.
    const second = transcriptBlocks({
      segments: [seg(0, first[0]?.text ?? '')],
      offsetSec: 0,
      id: ids('b'),
      glossary,
    })

    expect(first[0]?.text).toBe('el algoritmo FSRS')
    expect(first[0]?.hash).toBe(sha256Hex('el algoritmo FSRS'))
    // Hashing first would key the block on text nobody stores, and every re-parse would then
    // look like a change to 6.2 — a new chunk, and a new embedding paid for twice.
    expect(first[0]?.hash).not.toBe(sha256Hex(' el algoritmo fs rs '))
    expect(second[0]?.hash).toBe(first[0]?.hash)
  })

  it('leaves the text alone when no glossary is supplied', () => {
    const blocks = transcriptBlocks({ segments: [seg(0, 'fs rs')], offsetSec: 0, id: ids('b') })

    expect(blocks[0]?.text).toBe('fs rs')
  })

  it('returns nothing for a recording with no speech in it', () => {
    expect(transcriptBlocks({ segments: [], offsetSec: 0, id: ids('b') })).toEqual([])
    expect(transcriptBlocks({ segments: [seg(0, ' ')], offsetSec: 0, id: ids('b') })).toEqual([])
  })
})

describe('fuseSaidAndShown', () => {
  it('describes a slide once per bucket rather than once per frame', () => {
    // Four minutes of one slide, sampled every 10 s: 24 frames reach here because a slow fade
    // or a moving cursor puts them more than eight bits apart for the dHash pass.
    const frames = Array.from({ length: 24 }, (_, index) => ({
      timeSec: index * 10,
      text: 'AGENDA',
    }))

    const blocks = fuseSaidAndShown({ frames, id: ids('f') })

    // The ceiling is the bucket, not the slide: four minutes spans two of them, which is two
    // blocks instead of twenty-four.
    expect(blocks).toHaveLength(2)
    expect(blocks.map((entry) => entry.locator.timeSec)).toEqual([0, FUSION_BUCKET_SECONDS])
  })

  it('keeps the first legible frame of a bucket and drops the rest of it', () => {
    const blocks = fuseSaidAndShown({
      frames: [
        { timeSec: 10, text: 'SECTION ONE' },
        { timeSec: 100, text: 'SECTION TWO' },
        { timeSec: 160, text: 'SECTION THREE' },
      ],
      id: ids('f'),
    })

    // De-duplication is by time alone, not by what the frames say, so a second slide inside
    // the same 150 s is not described at all — the cost of a rule that needs no state.
    expect(blocks.map((entry) => entry.text)).toEqual([
      'On screen (0:10): SECTION ONE',
      'On screen (2:40): SECTION THREE',
    ])
  })

  it('produces nothing at all for frames with no legible text', () => {
    const blocks = fuseSaidAndShown({
      frames: [
        { timeSec: 0, text: '' },
        { timeSec: 10, text: '   \n\t' },
      ],
      id: ids('f'),
    })

    expect(blocks).toEqual([])
  })

  it('does not let an illegible frame claim the bucket a readable one would fill', () => {
    // The filter runs before the bucketing, so a black frame at the top of the minute costs
    // nothing: the slide that follows it inside the same bucket is still described.
    const blocks = fuseSaidAndShown({
      frames: [
        { timeSec: 0, text: '  ' },
        { timeSec: 20, text: 'LA CURVA DEL OLVIDO' },
      ],
      id: ids('f'),
    })

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.text).toBe('On screen (0:20): LA CURVA DEL OLVIDO')
  })

  it('stamps the block at the frame, which is what fuses said with shown', () => {
    // Nothing in this module merges speech and slides. The block simply carries a time, and
    // 6.2's windowing — which sorts every timed block and cuts at a pause — is what puts the
    // description of a slide inside the same 60–90 s window as the words spoken over it. That
    // emergent behaviour is the whole design: a second code path through the chunker would
    // have to re-derive the boundaries it already computed.
    const blocks = fuseSaidAndShown({
      frames: [{ timeSec: 372.5, text: 'DIAGRAMA' }],
      id: ids('f'),
    })

    expect(blocks[0]?.locator.timeSec).toBe(372.5)
    expect(blocks[0]?.type).toBe('figure')
  })

  it('caps a frame at MAX_FRAME_TEXT_CHARS of description', () => {
    // A slide of dense body text, or an OCR pass that read the speaker's notes too: without a
    // ceiling one frame could outweigh the minute of speech it belongs to.
    const wall = 'A'.repeat(MAX_FRAME_TEXT_CHARS + 500)
    const labelled = fuseSaidAndShown({ frames: [{ timeSec: 0, text: wall }], id: ids('f') })
    const bare = fuseSaidAndShown({
      frames: [{ timeSec: 0, text: wall }],
      id: ids('f'),
      label: () => '',
    })

    expect(bare[0]?.text).toHaveLength(MAX_FRAME_TEXT_CHARS)
    // The cap is on the frame's contribution, so the caption still fits in front of it.
    expect(labelled[0]?.text).toBe(`On screen (0:00): ${'A'.repeat(MAX_FRAME_TEXT_CHARS)}`)
  })

  it('takes the caption from the caller, because the default is English and the app is es-AR', () => {
    const blocks = fuseSaidAndShown({
      frames: [{ timeSec: 65, text: 'TÍTULO' }],
      id: ids('f'),
      label: (timeSec) => `En pantalla (${timestampLabel(timeSec)}): `,
    })

    expect(blocks[0]?.text).toBe('En pantalla (1:05): TÍTULO')
    // The caption is part of what a lesson writer reads, so it is part of the identity too.
    expect(blocks[0]?.hash).toBe(sha256Hex('En pantalla (1:05): TÍTULO'))
  })

  it('defaults to a caption stamped with the same label a citation shows', () => {
    const blocks = fuseSaidAndShown({ frames: [{ timeSec: 3_725, text: 'TÍTULO' }], id: ids('f') })

    expect(blocks[0]?.text).toBe('On screen (1:02:05): TÍTULO')
  })

  it("buckets frames by their time however they arrived, and leaves the caller's array alone", () => {
    const frames = [
      { timeSec: 200, text: 'DOS' },
      { timeSec: 5, text: 'UNO' },
    ]

    const blocks = fuseSaidAndShown({ frames, id: ids('f'), bucketSeconds: 100 })

    expect(blocks.map((entry) => entry.locator.timeSec)).toEqual([5, 200])
    expect(frames.map((frame) => frame.timeSec)).toEqual([200, 5])
  })

  it('honours a bucket size the caller chose over the default', () => {
    const frames = [
      { timeSec: 0, text: 'UNO' },
      { timeSec: 30, text: 'DOS' },
      { timeSec: 90, text: 'TRES' },
    ]

    expect(fuseSaidAndShown({ frames, id: ids('f'), bucketSeconds: 60 })).toHaveLength(2)
    expect(fuseSaidAndShown({ frames, id: ids('f') })).toHaveLength(1)
  })
})

describe('byTime', () => {
  it('puts the blocks in the order the recording happened', () => {
    const ordered = byTime([block('c', 90), block('a', 5), block('b', 12.5)])

    expect(ordered.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
  })

  it('treats a block with no time as the start of the recording', () => {
    // Nothing in 6.4 emits one, but a source assembled from a media part plus a description
    // has untimed blocks in it; reading `undefined` as 0 keeps them at the head rather than
    // scattering them through the transcript on `NaN` comparisons.
    const ordered = byTime([block('speech', 30), block('untimed'), block('opening', 0)])

    expect(ordered.map((entry) => entry.id)).toEqual(['untimed', 'opening', 'speech'])
  })

  it('keeps two blocks stamped at the same second in the order they were pushed', () => {
    // Chunk keys are derived from block ids in order, so a tie resolved differently between
    // two runs would re-key every chunk of the window and re-embed it.
    const tied = [block('speech', 60), block('slide', 60), block('later', 61)]

    expect(byTime(tied).map((entry) => entry.id)).toEqual(['speech', 'slide', 'later'])
    expect(byTime(byTime(tied)).map((entry) => entry.id)).toEqual(['speech', 'slide', 'later'])
  })

  it("returns a new array instead of sorting the caller's in place", () => {
    const blocks = [block('b', 20), block('a', 10)]

    expect(byTime(blocks)).not.toBe(blocks)
    expect(blocks.map((entry) => entry.id)).toEqual(['b', 'a'])
  })
})

/** A source as `parseMedia` assembles it: one part, one section, every block timed. */
function videoDoc(title: string, blocks: readonly Block[]): SourceDoc {
  return {
    id: 'doc-1',
    kind: 'video',
    title,
    language: 'es',
    sections: [
      { id: 's-1', title, level: 0, blocks: blocks.map((entry) => entry.id), children: [] },
    ],
    blocks: [...blocks],
    assets: [],
    meta: { warnings: [] },
  }
}

describe('what sub-phase 6.2 receives', () => {
  it('chunks as a transcript, with the slide in the same window as the words spoken over it', () => {
    const id = ids('b')
    const speech = transcriptBlocks({
      segments: Array.from({ length: 18 }, (_, index) => seg(index * 10, spoken(10))),
      offsetSec: 0,
      id,
    })
    const shown = fuseSaidAndShown({ frames: [{ timeSec: 65, text: 'LA CURVA DEL OLVIDO' }], id })
    const doc = videoDoc('Clase 1', byTime([...speech, ...shown]))

    // The whole handshake: a kind of `video` plus at least one numeric `timeSec`.
    expect(isTranscript(doc)).toBe(true)

    const result = chunkSourceDoc(doc, { sourceId: '01920000-0000-7000-8000-000000000000' })

    expect(result.units.length).toBeGreaterThan(1)
    expect(result.units.every((unit) => unit.kind === 'segment')).toBe(true)
    expect(result.chunks.every((chunk) => chunk.unitKey?.startsWith('segment:') === true)).toBe(
      true,
    )

    const slideId = shown[0]?.id as string
    const chunk = result.chunks.find((entry) => entry.blockIds.includes(slideId))

    expect(chunk?.text).toContain('LA CURVA DEL OLVIDO')
    // The speech that was live at 1:05 is in that same chunk, which is the "said + shown"
    // merge of §1 arriving with no merging code anywhere in 6.4.
    expect(chunk?.blockIds).toContain(speech[6]?.id)
    expect(chunk?.locator.t_start ?? Number.NaN).toBeLessThanOrEqual(65_000)
    expect(chunk?.locator.t_end ?? Number.NaN).toBeGreaterThanOrEqual(65_000)
  })
})
