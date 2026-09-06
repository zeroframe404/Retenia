import { dedupeFrames, type HashedFrame } from './dhash'

/**
 * Choosing which extracted frames to keep (`docs/spec/05-ingestion-rag.md` §1:
 * "**20–60 keyframes/hour**").
 *
 * The band is a budget, not a target. Every kept frame costs a blob, an OCR pass and a token
 * or two of a lesson prompt later, so the ceiling is what keeps a two-hour course from
 * turning into four hundred images; the floor is what keeps a screencast of one motionless
 * slide from producing a source with nothing to look at.
 *
 * The floor also has to survive a short clip. Twenty frames per hour is 0.11 frames in twenty
 * seconds, so a naive `round(rate * hours)` yields zero for exactly the sample the acceptance
 * criterion ("≥ 1 keyframe") is written against. `minimumKeep` therefore never returns less
 * than one for a source that has any video at all.
 */

export const MIN_FRAMES_PER_HOUR = 20
export const MAX_FRAMES_PER_HOUR = 60
/** Never more than this from one source, however long it is. */
export const ABSOLUTE_MAX_FRAMES = 400

export function minimumKeep(durationSec: number | null): number {
  if (durationSec === null || durationSec <= 0) return 1
  // Clamped to the ceiling, which `ABSOLUTE_MAX_FRAMES` caps: past twenty hours the two rates
  // cross, and an unclamped floor would demand more frames than the pipeline is ever willing
  // to keep — making `sceneDetectionFailed` true for every long source however well the scene
  // filter did, and the interval fallback unconditional.
  const byRate = Math.ceil((MIN_FRAMES_PER_HOUR * durationSec) / 3_600)
  return Math.max(1, Math.min(byRate, maximumKeep(durationSec)))
}

export function maximumKeep(durationSec: number | null): number {
  if (durationSec === null || durationSec <= 0) return 3
  const byRate = Math.ceil((MAX_FRAMES_PER_HOUR * durationSec) / 3_600)
  return Math.min(ABSOLUTE_MAX_FRAMES, Math.max(3, byRate))
}

/**
 * How much each frame differs from the one kept before it — its novelty.
 *
 * Used only to decide what to drop when there are too many. Keeping the most novel frames
 * rather than an evenly spaced sample is the difference between a strip that shows every slide
 * once and one that shows the same slide six times because it happened to be on screen at the
 * sampled moments.
 */
function novelty(frames: readonly HashedFrame[]): Map<number, number> {
  const scores = new Map<number, number>()
  let previous: bigint | undefined
  for (const frame of frames) {
    // The first frame is maximally novel: there was nothing on screen before it.
    let score = 64
    if (previous !== undefined) {
      let diff = frame.hash ^ previous
      score = 0
      while (diff !== 0n) {
        diff &= diff - 1n
        score += 1
      }
    }
    scores.set(frame.index, score)
    previous = frame.hash
  }
  return scores
}

export interface SelectionResult {
  kept: HashedFrame[]
  /** How many the dedupe pass removed, for the job's log and `SourceDoc.meta`. */
  duplicatesDropped: number
  /** How many were dropped only because of the per-hour ceiling. */
  overBudgetDropped: number
}

/**
 * Dedupes, then trims to the per-hour ceiling.
 *
 * In that order on purpose: trimming first would spend the budget on near-identical frames and
 * then have nothing left for the slide that actually changed.
 */
export function selectKeyframes(
  frames: readonly HashedFrame[],
  durationSec: number | null,
): SelectionResult {
  const deduped = dedupeFrames(frames)
  const duplicatesDropped = frames.length - deduped.length
  const ceiling = maximumKeep(durationSec)

  if (deduped.length <= ceiling) {
    return { kept: deduped, duplicatesDropped, overBudgetDropped: 0 }
  }

  const scores = novelty(deduped)
  const kept = [...deduped]
    .sort((left, right) => {
      const diff = (scores.get(right.index) ?? 0) - (scores.get(left.index) ?? 0)
      // Ties broken by time, so the result never depends on sort stability.
      return diff !== 0 ? diff : left.index - right.index
    })
    .slice(0, ceiling)
    .sort((left, right) => left.index - right.index)

  return { kept, duplicatesDropped, overBudgetDropped: deduped.length - kept.length }
}

/**
 * Whether the scene-change pass found too little to be believed, and the interval pass should
 * run instead.
 *
 * Measured on this sub-phase's own fixture: ffmpeg normalises `scene` by frame complexity, so
 * a hard cut between two flat slides scores **0.1–0.3** and falls *below* the spec's 0.3
 * threshold, while a cut in camera footage clears it easily. Screencasts — the Udemy case this
 * feature exists for — are therefore exactly the content the scene filter is worst at, and the
 * `fps=1/10` fallback is not an edge case but the normal path for them. See `docs/perf/media.md`.
 */
export function sceneDetectionFailed(sceneFrames: number, durationSec: number | null): boolean {
  return sceneFrames < minimumKeep(durationSec)
}
