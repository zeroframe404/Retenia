import type { GradeResult as CoreGradeResult } from '@retenia/core'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import { type GradeResult, gradeResultSchema, toReviewSpec } from './grade-result'

/** `GradeResult` of `docs/spec/03-activities.md` §7 on top of core's minimal one. */
describe('gradeResultSchema', () => {
  const full: GradeResult = {
    score: 0.75,
    correct: false,
    perItem: [{ id: 'a', correct: true, expected: 'x', got: 'x' }],
    feedback: '3 of 4.',
    rating: null,
    meta: {
      timeMs: 4000,
      attempts: 1,
      hintsUsed: 0,
      confidence: 'sure',
      engine: 'fuzzy',
      signals: { pairsOutOfOrder: 1 },
    },
  }

  it('accepts a full result and the minimal one', () => {
    expect(gradeResultSchema.safeParse(full).success).toBe(true)
    expect(
      gradeResultSchema.safeParse({
        score: 1,
        correct: true,
        feedback: '',
        rating: 4,
        meta: { timeMs: 0, attempts: 1, hintsUsed: 0 },
      }).success,
    ).toBe(true)
  })

  it('rejects scores outside [0, 1], a Manual rating and malformed meta', () => {
    expect(gradeResultSchema.safeParse({ ...full, score: 1.1 }).success).toBe(false)
    expect(gradeResultSchema.safeParse({ ...full, rating: 0 }).success).toBe(false)
    expect(
      gradeResultSchema.safeParse({ ...full, meta: { ...full.meta, attempts: 0 } }).success,
    ).toBe(false)
    expect(
      gradeResultSchema.safeParse({ ...full, meta: { ...full.meta, timeMs: -1 } }).success,
    ).toBe(false)
  })

  it('is assignable to core’s GradeResult, so toRating takes it as-is', () => {
    expectTypeOf<GradeResult>().toMatchTypeOf<CoreGradeResult>()
    expectTypeOf<z.infer<typeof gradeResultSchema>>().toMatchTypeOf<GradeResult>()
  })
})

describe('toReviewSpec()', () => {
  it('renames ratingStrategy to rule and keeps expectedSeconds only when present', () => {
    expect(
      toReviewSpec({ review: { eligible: true, ratingStrategy: 'fuzzy', expectedSeconds: 12 } }),
    ).toEqual({ eligible: true, rule: 'fuzzy', expectedSeconds: 12 })
    expect(toReviewSpec({ review: { eligible: false, ratingStrategy: 'none' } })).toEqual({
      eligible: false,
      rule: 'none',
    })
  })
})
