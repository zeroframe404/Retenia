import { RATING_RULES } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { GRADING_METHODS, gradingSchema, reviewSchema } from './grading'

/** The `grading` and `review` blocks of `docs/spec/03-activities.md` §7. */
describe('gradingSchema', () => {
  it('accepts every grader of §2 plus none, and only those', () => {
    expect(GRADING_METHODS).toEqual(['det', 'fuzzy', 'ai', 'self', 'speech', 'code', 'cas', 'none'])
    for (const method of GRADING_METHODS) {
      expect(gradingSchema.safeParse({ method }).success).toBe(true)
    }
    expect(gradingSchema.safeParse({ method: 'llm' }).success).toBe(false)
  })

  it('enforces the numeric ranges at their boundaries', () => {
    const ok = (extra: Record<string, unknown>) =>
      gradingSchema.safeParse({ method: 'det', ...extra }).success
    expect(ok({ hintPenalty: 1 })).toBe(true)
    expect(ok({ hintPenalty: 1.01 })).toBe(false)
    expect(ok({ hintPenalty: -0.1 })).toBe(false)
    expect(ok({ maxAttempts: 1 })).toBe(true)
    expect(ok({ maxAttempts: 0 })).toBe(false)
    expect(ok({ maxAttempts: 1.5 })).toBe(false)
    expect(ok({ timeLimitSec: 0 })).toBe(false)
    expect(ok({ fuzzy: { maxRelativeEditDistance: 0.2, synonyms: [['a', 'b']] } })).toBe(true)
    expect(ok({ fuzzy: { synonyms: [['alone']] } })).toBe(false)
    expect(ok({ numeric: { absTol: 0, relTol: 0.05, units: ['km'] } })).toBe(true)
    expect(ok({ numeric: { absTol: -1 } })).toBe(false)
  })
})

describe('reviewSchema', () => {
  it("uses core's RatingRule vocabulary for ratingStrategy", () => {
    for (const ratingStrategy of RATING_RULES) {
      expect(reviewSchema.safeParse({ eligible: true, ratingStrategy }).success).toBe(true)
    }
    // The spec's abbreviations are not accepted: there is one vocabulary, `toRating`'s.
    expect(reviewSchema.safeParse({ eligible: true, ratingStrategy: 'bin' }).success).toBe(false)
    expect(reviewSchema.safeParse({ eligible: true, ratingStrategy: 'pct' }).success).toBe(false)
  })

  it('requires expectedSeconds to be a positive integer when present', () => {
    expect(
      reviewSchema.safeParse({ eligible: false, ratingStrategy: 'none', expectedSeconds: 15 })
        .success,
    ).toBe(true)
    expect(
      reviewSchema.safeParse({ eligible: false, ratingStrategy: 'none', expectedSeconds: 0 })
        .success,
    ).toBe(false)
  })
})
