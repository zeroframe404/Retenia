import type { GradingKeyPoint } from '@retenia/core'
import { coversPhrase } from '../families/long-text'

/**
 * Weighted key-point coverage of a free-text answer — the same FUZ set-match `gradeLongText`
 * runs (`docs/spec/03-activities.md` §4 row 7), expressed over the *port's* `GradingKeyPoint`
 * rather than over an `Activity`, so the pre-grader and the fake grader can share it.
 */

export interface KeyPointCoverage {
  /** Weighted fraction of the key points the answer covers, in `[0, 1]`. */
  score: number
  /** Ids of the key points the answer makes, in the order they were authored. */
  covered: readonly string[]
  missed: readonly string[]
  /** How many key points there were at all; `0` means coverage says nothing. */
  total: number
}

export const NO_COVERAGE: KeyPointCoverage = Object.freeze({
  score: 0,
  covered: Object.freeze([]),
  missed: Object.freeze([]),
  total: 0,
})

export function keyPointCoverage(
  answer: string,
  keyPoints: readonly GradingKeyPoint[] | undefined,
): KeyPointCoverage {
  if (keyPoints === undefined || keyPoints.length === 0) return NO_COVERAGE

  const covered: string[] = []
  const missed: string[] = []
  // Every weight is at least 1 — an absent or non-positive one defaults to it — so over a
  // non-empty list the total is never zero and the division below is always defined.
  let weightTotal = 0
  let weightCovered = 0
  for (const point of keyPoints) {
    const weight = point.weight !== undefined && point.weight > 0 ? point.weight : 1
    weightTotal += weight
    const hit = [point.text, ...(point.aliases ?? [])].some((phrase) =>
      coversPhrase(answer, phrase),
    )
    if (hit) {
      weightCovered += weight
      covered.push(point.id)
    } else {
      missed.push(point.id)
    }
  }
  return { score: weightCovered / weightTotal, covered, missed, total: keyPoints.length }
}
