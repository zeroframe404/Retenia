import { sha256Hex } from '../hash'
import type { SourceDoc } from '../source-doc'
import { chunkKey } from './chunk-key'
import type { NormalizedBlock, NormalizedDoc } from './normalize'
import type { ChunkDraft, ChunkingResult, SourceUnitDraft } from './types'

/**
 * Transcripts, chunked by time rather than by structure: "60–90 s windows aligned to pauses
 * with `start/end`" (`docs/spec/05-ingestion-rag.md` §4.1) — the "jump to the minute" citation.
 *
 * A transcript has no headings to cut at, so the boundary has to come from the recording
 * itself. The one signal an ASR segment list gives for free is *slack*: the wall-clock gap
 * between two consecutive segment starts, minus how long the first one's words plausibly took
 * to say. A speaker who pauses between two ideas leaves a large slack there and none inside a
 * sentence, so the window closes at the largest slack inside the 60–90 s band rather than at a
 * fixed 75 s that would land mid-clause.
 *
 * The parsers that produce these blocks are sub-phase 6.4's (ffmpeg + local Whisper); until
 * they land this path is exercised by synthetic documents with `locator.timeSec` set, which is
 * all it reads.
 */

/** Characters of speech per second, for turning a segment's text into a duration. Measured at
 *  ~150 words/min in both Spanish and English, at ~6 characters per word including the space. */
const CHARS_PER_SECOND = 15

/** How long the *last* segment lasts, which has no successor to bound it. */
function spokenSeconds(text: string): number {
  return text.length / CHARS_PER_SECOND
}

/** Source kinds whose blocks are transcript segments. */
const TRANSCRIPT_KINDS: ReadonlySet<SourceDoc['kind']> = new Set(['audio', 'video', 'youtube'])

/** A document is a transcript when its kind says so *and* its blocks are actually timed —
 *  a YouTube page scraped without captions is chunked as prose like any other web page. */
export function isTranscript(doc: SourceDoc): boolean {
  if (!TRANSCRIPT_KINDS.has(doc.kind)) return false
  return doc.blocks.some((block) => typeof block.locator.timeSec === 'number')
}

interface Segment {
  normalized: NormalizedBlock
  startSec: number
  /** Where the next segment starts, or this one's own estimated end for the last. */
  endSec: number
  /** Silence between the end of this segment's speech and the start of the next. */
  slackSec: number
}

function toSegments(normalized: NormalizedDoc): Segment[] {
  const timed = normalized.blocks.filter((entry) => typeof entry.block.locator.timeSec === 'number')
  timed.sort((left, right) => {
    const a = left.block.locator.timeSec as number
    const b = right.block.locator.timeSec as number
    return a === b ? left.start - right.start : a - b
  })

  return timed.map((entry, index) => {
    const startSec = entry.block.locator.timeSec as number
    const next = timed[index + 1]
    const nextStart = next === undefined ? undefined : (next.block.locator.timeSec as number)
    const spoken = spokenSeconds(entry.text)
    const endSec = nextStart ?? startSec + spoken
    return {
      normalized: entry,
      startSec,
      endSec,
      slackSec: Math.max(0, endSec - startSec - spoken),
    }
  })
}

/**
 * Cuts the segment list into windows. A window always reaches `min` seconds if there are
 * enough segments left; past that it keeps the boundary with the most slack until adding one
 * more segment would take it past `max`, and closes there.
 */
function windowize(segments: readonly Segment[], min: number, max: number): Segment[][] {
  const windows: Segment[][] = []
  let index = 0

  while (index < segments.length) {
    const start = (segments[index] as Segment).startSec
    let best: { at: number; slack: number } | undefined
    let cursor = index

    while (cursor < segments.length) {
      const segment = segments[cursor] as Segment
      const elapsed = segment.endSec - start
      // Never let a window pass `max`, unless it has not yet closed a single segment — one
      // segment longer than the whole window is its own window.
      if (elapsed > max && cursor > index) break
      if (elapsed >= min && (best === undefined || segment.slackSec > best.slack)) {
        best = { at: cursor, slack: segment.slackSec }
      }
      cursor += 1
      if (elapsed > max) break
    }

    // No boundary reached `min`: the transcript ran out, so everything left is the last window.
    const end = best?.at ?? cursor - 1
    windows.push(segments.slice(index, end + 1))
    index = end + 1
  }

  return windows
}

export interface TranscriptChunkOptions {
  sourceId: string
  countTokens: (text: string) => number
  chunkingVersion: string
  window: { min: number; max: number }
  maxSectionTokens: number
  frontMatterBlocks: ReadonlySet<string>
}

const SECONDS_PER_MINUTE = 60

/** `12:30`, or `1:02:30` past the hour — the label a citation shows. */
export function timestampLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(whole / 3_600)
  const minutes = Math.floor((whole % 3_600) / SECONDS_PER_MINUTE)
  const secs = whole % SECONDS_PER_MINUTE
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(secs).padStart(2, '0')}`
}

export function chunkTranscript(
  doc: SourceDoc,
  normalized: NormalizedDoc,
  options: TranscriptChunkOptions,
): ChunkingResult {
  const segments = toSegments(normalized)
  const warnings: string[] = []
  const units: SourceUnitDraft[] = []
  const chunks: ChunkDraft[] = []

  const windows = windowize(segments, options.window.min, options.window.max)

  windows.forEach((window, index) => {
    const first = window[0] as Segment
    const last = window.at(-1) as Segment
    const blockIds = window.map((segment) => segment.normalized.block.id)
    const charStart = first.normalized.start
    const charEnd = last.normalized.end
    const text = normalized.text.slice(charStart, charEnd)
    const tStartMs = Math.round(first.startSec * 1_000)
    const tEndMs = Math.round(last.endSec * 1_000)
    const label = timestampLabel(first.startSec)
    const key = `segment:${index + 1}`

    units.push({
      key,
      kind: 'segment',
      ordinal: index + 1,
      label,
      tStartMs,
      tEndMs,
      text,
      blockIds,
    })

    const tokenCount = options.countTokens(text)
    if (tokenCount > options.maxSectionTokens) {
      warnings.push(
        `Transcript window ${label} is ${tokenCount} tokens, above the ${options.maxSectionTokens}-token ceiling`,
      )
    }

    chunks.push({
      key: chunkKey(options.sourceId, blockIds, text),
      ordinal: index,
      text,
      tokenCount,
      charStart,
      charEnd,
      hash: sha256Hex(text),
      headingPath: doc.title.trim().length > 0 ? doc.title.trim() : null,
      blockIds,
      unitKey: key,
      // A time window is not a section: the 150-token floor, which is a rule about structure,
      // does not apply to it, and there is no section id to report.
      sectionId: null,
      isFrontmatter: blockIds.every((id) => options.frontMatterBlocks.has(id)),
      locator: { t_start: tStartMs, t_end: tEndMs, label, block_ids: blockIds },
    })
  })

  return {
    units,
    chunks,
    chunkingVersion: options.chunkingVersion,
    normalizedText: normalized.text,
    warnings,
  }
}
