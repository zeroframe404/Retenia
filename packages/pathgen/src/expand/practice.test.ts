import type { ActivityFamily, ActivityOption, AuthoredActivity } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { composePractice, LESSON_PRACTICE_LIMITS } from './practice'

/**
 * The over-generation filter, over candidates shaped exactly as `ActivityAuthor.collect`
 * hands them over. The rules themselves are `composeLessonPractice`'s and are property-tested
 * in `@retenia/core`; what is checked here is that a real pool reaches them and that the
 * chosen options come back out as rows in the order they will be served.
 */

let next = 0

function candidate(
  type: string,
  family: ActivityFamily,
  overrides: Partial<ActivityOption> = {},
): AuthoredActivity {
  next += 1
  const key = `call#${next}`
  const option: ActivityOption = {
    activityId: key,
    type,
    family,
    progression: 'recognition',
    ratingStrategy: 'binary',
    expectedSeconds: 30,
    eligible: true,
    hasMedia: false,
    needsMic: false,
    needsSandbox: false,
    difficulty: 3,
    bloom: 'understand',
    conceptIds: ['c1'],
    lastServedAt: null,
    ...overrides,
  }
  return {
    key,
    option,
    row: {
      type,
      family,
      schemaVersion: 1,
      lang: 'es-AR',
      bloom: option.bloom,
      difficulty: option.difficulty,
      conceptIds: [...option.conceptIds],
      misconceptionIds: [],
      config: { prompt: `${type} ${key}` },
      grading: { method: 'det' },
      status: 'ready',
      sourceRefs: [],
    },
  }
}

/** A pool with the variety §4 asks for: several families, a production tail, an apply item. */
function healthyPool(): AuthoredActivity[] {
  return [
    candidate('mcq_single', 'choice', { difficulty: 1 }),
    candidate('mcq_single', 'choice', { difficulty: 2 }),
    candidate('true_false', 'choice', { difficulty: 1 }),
    candidate('cloze_typed', 'cloze', { difficulty: 2, progression: 'production' }),
    candidate('cloze_dropdown', 'cloze', { difficulty: 2 }),
    candidate('short_answer', 'text_input', { difficulty: 3, progression: 'production' }),
    candidate('matching_pairs', 'pairs', { difficulty: 3 }),
    candidate('ordering_sequence', 'ordering', { difficulty: 4 }),
    candidate('free_recall', 'long_text', {
      difficulty: 5,
      progression: 'production',
      bloom: 'apply',
      ratingStrategy: 'ai',
    }),
  ]
}

describe('composePractice()', () => {
  it('keeps 4–8 activities with the variety §4 asks for', () => {
    const composed = composePractice(healthyPool(), 'L01', 'seed')
    expect(composed.rows.length).toBeGreaterThanOrEqual(LESSON_PRACTICE_LIMITS.min)
    expect(composed.rows.length).toBeLessThanOrEqual(LESSON_PRACTICE_LIMITS.max)
    expect(new Set(composed.rows.map((row) => row.type)).size).toBeGreaterThanOrEqual(3)
    expect(new Set(composed.rows.map((row) => row.family)).size).toBeGreaterThanOrEqual(3)
    const mcq = composed.rows.filter((row) => row.type === 'mcq_single').length
    expect(mcq / composed.rows.length).toBeLessThanOrEqual(0.4)
    expect(composed.rows.some((row) => row.bloom === 'apply')).toBe(true)
    expect(composed.unmet).toEqual([])
  })

  it('numbers the block in the order it will be served', () => {
    const composed = composePractice(healthyPool(), 'L01', 'seed')
    expect(composed.rows.map((row) => row.ordinal)).toEqual(composed.rows.map((_, index) => index))
  })

  it('is seeded: the same pool and seed compose the same block', () => {
    const pool = healthyPool()
    const first = composePractice(pool, 'L01', 'seed')
    const second = composePractice(pool, 'L01', 'seed')
    expect(second.rows.map((row) => row.config)).toEqual(first.rows.map((row) => row.config))
  })

  it('reports the rules a thin pool cannot meet rather than throwing', () => {
    const allMcq = Array.from({ length: 8 }, () => candidate('mcq_single', 'choice'))
    const composed = composePractice(allMcq, 'L01', 'seed')
    expect(composed.rows.length).toBeGreaterThan(0)
    expect(composed.unmet.map((rule) => rule.rule)).toContain('mcq_share')
    expect(composed.warnings.map((entry) => entry.code)).toContain('practice_incomplete')
  })

  it('reports an empty pool instead of composing nothing silently', () => {
    const composed = composePractice([], 'L01', 'seed')
    expect(composed.rows).toEqual([])
    expect(composed.warnings.map((entry) => entry.code)).toEqual(['practice_incomplete'])
  })
})
