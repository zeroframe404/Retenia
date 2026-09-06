import { describe, expect, it } from 'vitest'
import { makeSourceDoc } from '../../test/make-source-doc'
import { chunkSourceDoc } from './chunk-source-doc'
import { timestampLabel } from './transcript'

/** ~15 characters of speech per second, the rate `transcript.ts` assumes. */
function speech(seconds: number): string {
  const chars = Math.round(seconds * 15)
  let text = ''
  for (let index = 0; text.length < chars; index += 1) text += `palabra${index % 10} `
  return text.slice(0, chars).trim()
}

/** A transcript that speaks continuously except for a deliberate pause. */
function transcript(options: {
  segmentSec: number
  count: number
  pauseAfterIndex?: number
  pauseSec?: number
}) {
  const segments: Array<{ text: string; atSec: number }> = []
  let at = 0
  for (let index = 0; index < options.count; index += 1) {
    segments.push({ text: speech(options.segmentSec), atSec: at })
    at += options.segmentSec
    if (index === options.pauseAfterIndex) at += options.pauseSec ?? 0
  }
  return makeSourceDoc({ title: 'Clase 1', kind: 'video', segments })
}

describe('timestampLabel', () => {
  it.each([
    [0, '0:00'],
    [65, '1:05'],
    [750, '12:30'],
    [3_725, '1:02:05'],
  ])('renders %i s as %s', (seconds, label) => {
    expect(timestampLabel(seconds)).toBe(label)
  })
})

describe('chunkSourceDoc, transcripts', () => {
  it('cuts 60–90 s windows with start and end times', () => {
    const doc = transcript({ segmentSec: 10, count: 30 })
    const result = chunkSourceDoc(doc, { sourceId: 'src' })

    expect(result.chunks.length).toBeGreaterThan(1)
    for (const chunk of result.chunks.slice(0, -1)) {
      const seconds = ((chunk.locator.t_end as number) - (chunk.locator.t_start as number)) / 1_000
      expect(seconds).toBeGreaterThanOrEqual(60)
      expect(seconds).toBeLessThanOrEqual(90)
    }
    // Windows tile the recording: each starts where the previous one ended.
    for (const [index, chunk] of result.chunks.slice(1).entries()) {
      expect(chunk.locator.t_start).toBe(result.chunks[index]?.locator.t_end)
    }
  })

  it('closes the window on the longest pause inside the band', () => {
    // Continuous 10 s segments, with 8 s of silence after the 7th (t = 70 s).
    const doc = transcript({ segmentSec: 10, count: 24, pauseAfterIndex: 6, pauseSec: 8 })
    const result = chunkSourceDoc(doc, { sourceId: 'src' })

    // Without the pause the greedy cut would land at the first boundary past 60 s; the pause
    // moves it to 70 s + the silence, which is where the speaker actually stopped.
    expect(result.chunks[0]?.locator.t_end).toBe(78_000)
    expect(result.chunks[1]?.locator.t_start).toBe(78_000)
  })

  it('makes one segment unit per window, labelled by its timestamp', () => {
    const doc = transcript({ segmentSec: 10, count: 20 })
    const result = chunkSourceDoc(doc, { sourceId: 'src' })

    expect(result.units).toHaveLength(result.chunks.length)
    for (const [index, unit] of result.units.entries()) {
      expect(unit.kind).toBe('segment')
      expect(unit.ordinal).toBe(index + 1)
      expect(unit.key).toBe(result.chunks[index]?.unitKey)
      expect(unit.label).toBe(timestampLabel((unit.tStartMs as number) / 1_000))
      expect(unit.tEndMs).toBeGreaterThan(unit.tStartMs as number)
    }
  })

  it('has no section id: a time window is not a section', () => {
    const doc = transcript({ segmentSec: 10, count: 20 })
    const result = chunkSourceDoc(doc, { sourceId: 'src' })
    for (const chunk of result.chunks) expect(chunk.sectionId).toBeNull()
  })

  it('gives a segment longer than the whole window a window of its own', () => {
    const doc = makeSourceDoc({
      title: 'Clase 1',
      kind: 'video',
      segments: [
        { text: speech(120), atSec: 0 },
        { text: speech(10), atSec: 120 },
        { text: speech(10), atSec: 130 },
      ],
    })

    const result = chunkSourceDoc(doc, { sourceId: 'src' })

    expect(result.chunks[0]?.blockIds).toEqual([doc.blocks[0]?.id])
    expect(result.chunks[0]?.locator.t_end).toBe(120_000)
    expect(result.chunks).toHaveLength(2)
  })

  it('keeps a recording shorter than one window whole', () => {
    const doc = transcript({ segmentSec: 10, count: 3 })
    const result = chunkSourceDoc(doc, { sourceId: 'src' })
    expect(result.chunks).toHaveLength(1)
    expect(result.chunks[0]?.blockIds).toHaveLength(3)
  })

  it('covers every segment exactly once, in order', () => {
    const doc = transcript({ segmentSec: 7, count: 41 })
    const result = chunkSourceDoc(doc, { sourceId: 'src' })
    expect(result.chunks.flatMap((chunk) => chunk.blockIds)).toEqual(
      doc.blocks.map((block) => block.id),
    )
  })

  it('falls back to structural chunking for a video with no timings', () => {
    const doc = makeSourceDoc({
      title: 'Clase sin transcripción',
      kind: 'video',
      sections: [{ title: 'Descripción', blocks: [{ text: speech(60) }] }],
    })
    const result = chunkSourceDoc(doc, { sourceId: 'src' })
    expect(result.chunks[0]?.sectionId).not.toBeNull()
    expect(result.units[0]?.kind).toBe('section')
  })
})
