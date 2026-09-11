import type { JsonObject } from '@retenia/core'
import { CLEAN_RATING } from './policy'

/**
 * §11 "Traceability: every remediation records its trigger and its effect (subsequent correct
 * answers) in order to tune thresholds". The effect, measured: what the learner did on the
 * concept after the detour was inserted — activity attempts graded correct, and reviews of the
 * concept's cards graded Good or better.
 */

export interface OutcomeInput {
  readonly attempts: readonly { readonly correct: boolean | null }[]
  readonly reviews: readonly { readonly rating: number }[]
  readonly now: Date
}

export function measureOutcome(input: OutcomeInput): JsonObject {
  const graded = input.attempts.filter((attempt) => attempt.correct !== null)
  const correct = graded.filter((attempt) => attempt.correct === true).length
  // A postpone (rating 0) is not a review and says nothing about recall.
  const reviews = input.reviews.filter((review) => review.rating > 0)
  const clean = reviews.filter((review) => review.rating >= CLEAN_RATING).length
  const total = graded.length + reviews.length
  return {
    attempts: graded.length,
    correct,
    reviews: reviews.length,
    clean_reviews: clean,
    accuracy: total === 0 ? null : Math.round(((correct + clean) / total) * 1000) / 1000,
    measured_at: input.now.toISOString(),
  }
}
