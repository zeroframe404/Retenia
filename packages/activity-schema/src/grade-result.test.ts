import type { GradeResult as CoreGradeResult } from '@retenia/core'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import { PLAIN_TEXT_MAX } from './common'
import {
  CRITERIA_MAX,
  FEEDBACK_MAX,
  GRADE_LINE_MAX,
  type GradeResult,
  gradeResultSchema,
  PER_ITEM_MAX,
  toReviewSpec,
} from './grade-result'

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

  it('bounds every string a model writes, so a poisoned grade cannot stall the feedback panel', () => {
    const ok = (patch: Partial<GradeResult>) =>
      gradeResultSchema.safeParse({ ...full, ...patch }).success
    expect(ok({ feedback: 'f'.repeat(FEEDBACK_MAX) })).toBe(true)
    expect(ok({ feedback: 'f'.repeat(FEEDBACK_MAX + 1) })).toBe(false)
    expect(
      ok({ perItem: [{ id: 'a', correct: false, got: 'g'.repeat(PLAIN_TEXT_MAX + 1) }] }),
    ).toBe(false)
    expect(
      ok({ perItem: Array.from({ length: PER_ITEM_MAX + 1 }, () => ({ id: 'a', correct: true })) }),
    ).toBe(false)
  })

  it('bounds the AI rubric breakdown that rides on `meta.ai`', () => {
    const ai = (patch: Record<string, unknown>) =>
      gradeResultSchema.safeParse({
        ...full,
        meta: { ...full.meta, ai: { perCriterion: [], evidence: [], ...patch } },
      }).success
    expect(ai({})).toBe(true)
    expect(
      ai({
        perCriterion: [
          {
            id: 'c1',
            criterion: 'Claridad',
            score: 1,
            weight: 1,
            comment: 'c'.repeat(GRADE_LINE_MAX + 1),
          },
        ],
      }),
    ).toBe(false)
    expect(ai({ evidence: [{ quote: 'q'.repeat(PLAIN_TEXT_MAX + 1) }] })).toBe(false)
    expect(ai({ evidence: Array.from({ length: CRITERIA_MAX + 1 }, () => ({ quote: 'q' })) })).toBe(
      false,
    )
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
