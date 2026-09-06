/**
 * One timeline across many media files.
 *
 * A course imported from a folder is a single source made of many lectures
 * (`docs/spec/05-ingestion-rag.md` §1: "the course index (folders/modules) is already a
 * candidate outline"), and everything downstream of ingestion — the transcript chunker, the
 * citations, the player, the scheduler's locators — wants *one* ordering, not a file plus an
 * offset. So the parts are laid end to end into a virtual timeline and every timestamp the
 * pipeline records is a position on it.
 *
 * The alternative, keeping each timestamp local and carrying a part index beside it, was
 * rejected for a concrete reason: `chunkTranscript` (sub-phase 6.2, already written and
 * tested) sorts blocks by `locator.timeSec` and cuts 60–90 s windows out of that order. Local
 * times would collide across parts and it would window across a lecture boundary. A global
 * timeline needs no change there at all, and a single file is simply a course with one part.
 *
 * This lives in `packages/core` because both `@retenia/ingest` (which writes the timestamps)
 * and `@retenia/readers` (which turns them back into a file and a seek position) need the same
 * arithmetic, and core is the only package both may import.
 */

export interface TimelinePart {
  /** Seconds from the start of the whole source at which this part begins. */
  startSec: number
  /** Its own length. `null` when the container never said and no probe could tell. */
  durationSec: number | null
}

export interface TimelinePosition {
  /** Index into the part list. */
  part: number
  /** Seconds from the start of *that* part — what a `<video>` element is seeked to. */
  localSec: number
}

/**
 * Lays parts end to end, in the order given.
 *
 * A part of unknown length contributes nothing to the offset of the ones after it. That is the
 * least-wrong choice: the alternative is to guess, and a guessed offset would put every
 * later lecture's citations at a time that does not exist in any file. A known-length part
 * after an unknown one still gets a stable, monotone position, and the unknown one's own
 * timestamps stay correct relative to its start.
 */
export function buildTimeline(durations: readonly (number | null)[]): TimelinePart[] {
  const parts: TimelinePart[] = []
  let cursor = 0
  for (const duration of durations) {
    const usable = duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null
    parts.push({ startSec: cursor, durationSec: usable })
    if (usable !== null) cursor += usable
  }
  return parts
}

/**
 * Where the timeline ends, or `null` when the last part's length is unknown.
 *
 * A *lower bound* rather than an exact total when an **earlier** part's length is unknown:
 * that part contributed nothing to the offsets, so everything after it sits earlier than it
 * really plays. A progress bar reading this as exact would be wrong by however long the
 * unmeasured lecture runs.
 */
export function totalDuration(parts: readonly TimelinePart[]): number | null {
  const last = parts.at(-1)
  if (last === undefined) return null
  if (last.durationSec === null) return null
  return last.startSec + last.durationSec
}

/** A local position on `part` → its position on the whole timeline. */
export function toGlobal(parts: readonly TimelinePart[], part: number, localSec: number): number {
  const entry = parts[part]
  if (entry === undefined) throw new Error(`no media part at index ${part}`)
  return entry.startSec + Math.max(0, localSec)
}

/**
 * A global position → the part playing at that moment and the offset inside it.
 *
 * A time that falls exactly on a boundary belongs to the *later* part, which is what makes
 * playback continuous: reaching the end of lecture 3 resolves to the start of lecture 4 rather
 * than to a position one frame before an end that has already been reached.
 */
export function toLocal(parts: readonly TimelinePart[], globalSec: number): TimelinePosition {
  if (parts.length === 0) throw new Error('an empty timeline has no positions')
  const time = Math.max(0, globalSec)

  // A part of *zero* length can never be the one playing — seeking into it would load a file
  // with nothing in it — so it is not a candidate at all. A part of *unknown* length is the
  // opposite case and stays eligible: it has content, we simply could not measure it.
  const playable = (part: TimelinePart): boolean =>
    part.durationSec === null || part.durationSec > 0

  let index = -1
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i] as TimelinePart
    if (time >= part.startSec && playable(part)) {
      index = i
      break
    }
  }
  if (index === -1) index = parts.findIndex(playable)
  if (index === -1) index = 0

  // Several parts can share an offset, because a part of unknown length advances the cursor by
  // nothing. Scanning backwards alone would then always answer with the *last* of them, and a
  // lecture ffprobe could not measure would be unreachable — every one of its timestamps
  // resolving into the following file. Playback order decides the tie instead: you cannot
  // reach the later part without passing through the earlier one, so the earlier one is the
  // one playing.
  while (
    index > 0 &&
    playable(parts[index - 1] as TimelinePart) &&
    (parts[index - 1] as TimelinePart).startSec === (parts[index] as TimelinePart).startSec
  ) {
    index -= 1
  }

  return { part: index, localSec: time - (parts[index] as TimelinePart).startSec }
}
