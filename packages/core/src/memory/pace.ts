/**
 * The rolling personal median that `toRating` compares an answer's time against.
 *
 * `docs/spec/02-memory-system.md` §10 is written in terms of the **personal median**
 * throughout — "time < personal median × 0.6", "time > 2× median" — and §9 repeats it for
 * mock exams. This module is the arithmetic behind that number; `ActivityStatsRepository`
 * is where it is stored, one row per activity type.
 *
 * A bounded FIFO window rather than a streaming estimator (P²): §13 also wants the median
 * *and* p90 per type, the window is small enough to keep whole, and — being a window that
 * slides — the median follows the user as they get faster at a type instead of averaging
 * their first week in forever. The exactness is not incidental: `toRating` hands out Easy
 * on the strength of this number, and an approximation that drifted 20 % would quietly
 * change the intervals of every fast answer.
 */

/**
 * How many recent durations one activity type keeps.
 *
 * Large enough that the median is stable across a session's worth of answers, small enough
 * that a user who has genuinely got quicker sees it within a few weeks of study — and that
 * every row stays a few kilobytes of JSON.
 */
export const PACE_SAMPLE_SIZE = 256

/** The materialized pace of one activity type. */
export interface ActivityPace {
  activityType: string
  /** Durations ever folded in — not the sample's length, which is capped. */
  reviews: number
  /** The exact median of `sample`, in milliseconds. `null` while the sample is empty. */
  medianMs: number | null
  /** The bounded FIFO the median is computed from, oldest first. */
  sample: readonly number[]
}

/**
 * The exact median of a sample, in milliseconds, rounded to an integer.
 *
 * The *lower* of the two middle values on an even count, matching
 * `ReviewLogRepository.medianDurationMs`'s `LIMIT 1 OFFSET n/2` so the two sources of a
 * median never disagree by an interpolation rule. `null` for an empty sample: there is no
 * median of nothing, and inventing one would hand out Easy on a first review.
 */
export function medianOf(sample: readonly number[]): number | null {
  if (sample.length === 0) return null
  const sorted = [...sample].sort((a, b) => a - b)
  const middle = sorted[Math.floor((sorted.length - 1) / 2)] as number
  return Math.max(1, Math.round(middle))
}

/**
 * Folds one review's duration into a type's window and recomputes the median.
 *
 * Pure: it takes the stored row and returns the row to store. Durations that are not a
 * positive finite number are ignored — an activity whose host never measured the time is
 * not evidence that it takes 0 ms — and the `reviews` counter only moves when the sample
 * does, so it stays the count of what the median is actually made of.
 */
export function foldPace(
  current: ActivityPace | undefined,
  activityType: string,
  durationMs: number,
  sampleSize: number = PACE_SAMPLE_SIZE,
): ActivityPace {
  const base: ActivityPace = current ?? {
    activityType,
    reviews: 0,
    medianMs: null,
    sample: [],
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) return base

  const rounded = Math.round(durationMs)
  const window = [...base.sample, rounded]
  // FIFO: the oldest measurements fall out, which is what makes the median follow the user.
  const sample = window.length > sampleSize ? window.slice(window.length - sampleSize) : window

  return {
    activityType,
    reviews: base.reviews + 1,
    medianMs: medianOf(sample),
    sample,
  }
}
