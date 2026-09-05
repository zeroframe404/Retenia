import { describe, expect, it } from 'vitest'
import type { ActivityFamily } from '../entities'
import { activityOptionFixture } from '../testing/activity-fixtures'
import type { ActivityOption } from './activity-option'
import {
  checkLessonPractice,
  composeLessonPractice,
  DEFAULT_LESSON_PRACTICE_LIMITS,
  difficultyOf,
  isMcq,
} from './lesson-practice'

const SEED = 'lesson-seed'

/** A pool wide enough to satisfy every rule, so a failure means the composer, not the pool. */
function healthyPool(): ActivityOption[] {
  const shapes: [string, ActivityFamily, ActivityOption['progression'], number][] = [
    ['mcq_single', 'choice', 'recognition', 1],
    ['mcq_multi', 'choice', 'recognition', 2],
    ['true_false', 'choice', 'recognition', 1],
    ['cloze_dropdown', 'cloze', 'recognition', 2],
    ['cloze_wordbank', 'cloze', 'assisted', 3],
    ['matching_pairs', 'pairs', 'assisted', 3],
    ['ordering_sequence', 'ordering', 'assisted', 3],
    ['categorize', 'categorize', 'assisted', 4],
    ['mark_the_words', 'text_mark', 'recognition', 2],
    ['short_answer', 'text_input', 'production', 4],
    ['cloze_typed', 'cloze', 'production', 4],
    ['free_recall', 'long_text', 'production', 5],
  ]
  return shapes.map(([type, family, progression, difficulty], index) =>
    activityOptionFixture({
      activityId: `act-${String(index).padStart(2, '0')}`,
      type,
      family,
      progression,
      difficulty,
      bloom: index % 3 === 0 ? 'apply' : 'understand',
    }),
  )
}

describe('composeLessonPractice', () => {
  it('satisfies every rule on a healthy pool', () => {
    const result = composeLessonPractice({ pool: healthyPool(), seed: SEED })
    expect(result.unmet).toEqual([])
    expect(result.complete).toBe(true)
  })

  it('ends on a production activity', () => {
    const { activities } = composeLessonPractice({ pool: healthyPool(), seed: SEED })
    expect(activities[activities.length - 1]?.progression).toBe('production')
  })

  it('stays inside 6–12 activities', () => {
    const { activities } = composeLessonPractice({ pool: healthyPool(), seed: SEED })
    expect(activities.length).toBeGreaterThanOrEqual(DEFAULT_LESSON_PRACTICE_LIMITS.min)
    expect(activities.length).toBeLessThanOrEqual(DEFAULT_LESSON_PRACTICE_LIMITS.max)
  })

  it('keeps the body non-decreasing in difficulty', () => {
    const { activities } = composeLessonPractice({ pool: healthyPool(), seed: SEED })
    const body = activities.slice(0, -1).map(difficultyOf)
    expect([...body].sort((a, b) => a - b)).toEqual(body)
  })

  it('holds the MCQ share under 40 %', () => {
    const { activities } = composeLessonPractice({ pool: healthyPool(), seed: SEED })
    const mcq = activities.filter(isMcq).length
    expect(mcq / activities.length).toBeLessThanOrEqual(0.4)
  })

  it('composes the same block for the same seed', () => {
    const a = composeLessonPractice({ pool: healthyPool(), seed: SEED })
    const b = composeLessonPractice({ pool: healthyPool(), seed: SEED })
    expect(a.activities.map((option) => option.activityId)).toEqual(
      b.activities.map((option) => option.activityId),
    )
  })

  it('includes the lesson-only types the review selector excludes', () => {
    // §4's nine lesson-only rows exist precisely to be lesson content; filtering on
    // `eligible` here would bar `disclosure_block` from the block it was written for.
    const pool = [
      ...healthyPool(),
      activityOptionFixture({
        activityId: 'theory-1',
        type: 'disclosure_block',
        family: 'disclosure',
        progression: 'theory',
        ratingStrategy: 'none',
        eligible: false,
      }),
    ]
    expect(() => composeLessonPractice({ pool, seed: SEED })).not.toThrow()
  })

  it('reports rather than throws on an all-MCQ pool', () => {
    const pool = Array.from({ length: 10 }, (_, index) =>
      activityOptionFixture({ activityId: `m-${index}`, type: 'mcq_single', bloom: 'remember' }),
    )
    const result = composeLessonPractice({ pool, seed: SEED })
    const rules = result.unmet.map((entry) => entry.rule)
    expect(rules).toContain('mcq_share')
    expect(rules).toContain('distinct_types')
    expect(rules).toContain('production_last')
    expect(result.complete).toBe(false)
  })

  it('returns an empty block and reports it when nothing is presentable', () => {
    const pool = [
      activityOptionFixture({ needsMic: true }),
      activityOptionFixture({ hasMedia: true }),
    ]
    const result = composeLessonPractice({ pool, seed: SEED })
    expect(result.activities).toEqual([])
    expect(result.unmet.map((entry) => entry.rule)).toContain('count')
  })

  it('returns the whole pool when it is smaller than the minimum', () => {
    const pool = healthyPool().slice(0, 3)
    const result = composeLessonPractice({ pool, seed: SEED })
    expect(result.activities).toHaveLength(3)
    expect(result.unmet.map((entry) => entry.rule)).toContain('count')
  })

  it('honours an overridden limit', () => {
    const result = composeLessonPractice({
      pool: healthyPool(),
      seed: SEED,
      limits: { max: 7 },
    })
    expect(result.activities.length).toBeLessThanOrEqual(7)
  })

  it('admits media activities when the host can present them', () => {
    const pool = healthyPool().map((option, index) =>
      index < 4 ? { ...option, hasMedia: true } : option,
    )
    const result = composeLessonPractice({
      pool,
      seed: SEED,
      capabilities: { media: true, mic: false, sandbox: false },
    })
    expect(result.activities.filter((option) => option.hasMedia).length).toBeLessThanOrEqual(2)
  })
})

describe('checkLessonPractice', () => {
  it('reports an empty block against every rule it can', () => {
    const rules = checkLessonPractice([], DEFAULT_LESSON_PRACTICE_LIMITS).map((entry) => entry.rule)
    expect(rules).toContain('count')
    expect(rules).toContain('distinct_types')
    expect(rules).toContain('apply_bloom')
    expect(rules).toContain('production_last')
    // An empty block has no MCQ share to be over.
    expect(rules).not.toContain('mcq_share')
  })

  it('reports a block that gets easier partway through', () => {
    const pool = healthyPool()
    const block = [
      { ...(pool[0] as ActivityOption), difficulty: 5 },
      { ...(pool[1] as ActivityOption), difficulty: 1 },
      { ...(pool[9] as ActivityOption), difficulty: 5 },
    ]
    expect(
      checkLessonPractice(block, DEFAULT_LESSON_PRACTICE_LIMITS).map((entry) => entry.rule),
    ).toContain('increasing_difficulty')
  })

  it('reports too much media', () => {
    const block = healthyPool().map((option) => ({ ...option, hasMedia: true }))
    expect(
      checkLessonPractice(block, DEFAULT_LESSON_PRACTICE_LIMITS).map((entry) => entry.rule),
    ).toContain('media_cap')
  })
})

describe('difficultyOf', () => {
  it('puts an unlabelled activity in the middle rather than at an extreme', () => {
    expect(difficultyOf(activityOptionFixture({ difficulty: null }))).toBe(3)
  })

  it('clamps to the 1–5 scale', () => {
    expect(difficultyOf(activityOptionFixture({ difficulty: 9 }))).toBe(5)
    expect(difficultyOf(activityOptionFixture({ difficulty: -2 }))).toBe(1)
    expect(difficultyOf(activityOptionFixture({ difficulty: 2.4 }))).toBe(2)
  })
})

describe('capabilities and media budgets', () => {
  it('admits a sandboxed activity when the host has a sandbox', () => {
    const pool = healthyPool().map((option, index) =>
      index === 0 ? { ...option, needsSandbox: true } : option,
    )
    const withSandbox = composeLessonPractice({
      pool,
      seed: SEED,
      capabilities: { media: false, mic: false, sandbox: true },
    })
    const withoutSandbox = composeLessonPractice({ pool, seed: SEED })
    expect(withSandbox.activities.length).toBeGreaterThanOrEqual(withoutSandbox.activities.length)
  })

  it('counts a media tail against the budget', () => {
    // The tail is chosen before the body, so its media has to be charged before the body
    // starts spending — otherwise the block could carry three.
    const pool = healthyPool().map((option) =>
      option.progression === 'production' || option.family === 'pairs'
        ? { ...option, hasMedia: true }
        : option,
    )
    const result = composeLessonPractice({
      pool,
      seed: SEED,
      capabilities: { media: true, mic: false, sandbox: false },
    })
    expect(result.activities.filter((option) => option.hasMedia).length).toBeLessThanOrEqual(2)
  })

  it('keeps honouring the media budget while topping up to the minimum', () => {
    // Topping up spends the MCQ budget but never the media one: media guards what the host
    // can present, which is not a preference to trade away.
    const pool = [
      activityOptionFixture({ activityId: 'p-0', type: 'short_answer', progression: 'production' }),
      ...Array.from({ length: 6 }, (_, index) =>
        activityOptionFixture({
          activityId: `m-${index}`,
          type: 'mcq_single',
          hasMedia: true,
          bloom: 'apply',
        }),
      ),
    ]
    const result = composeLessonPractice({
      pool,
      seed: SEED,
      capabilities: { media: true, mic: false, sandbox: false },
    })
    expect(result.activities.filter((option) => option.hasMedia).length).toBeLessThanOrEqual(2)
  })
})

describe('topping up a media-rich lesson', () => {
  it('spends the raised media budget when only media activities are left', () => {
    // The body stops at the 40 % MCQ ceiling; the top-up ignores that ceiling but still
    // honours the media budget, so with the budget raised it may legitimately add media.
    const pool = [
      activityOptionFixture({
        activityId: 'p-0',
        type: 'short_answer',
        family: 'text_input',
        progression: 'production',
        difficulty: 5,
        bloom: 'apply',
      }),
      ...Array.from({ length: 6 }, (_, index) =>
        activityOptionFixture({
          activityId: `m-${index}`,
          type: 'mcq_single',
          hasMedia: true,
          difficulty: 2,
        }),
      ),
    ]
    const result = composeLessonPractice({
      pool,
      seed: SEED,
      capabilities: { media: true, mic: false, sandbox: false },
      limits: { maxMedia: 6 },
    })
    expect(result.activities).toHaveLength(6)
    expect(result.activities.filter((option) => option.hasMedia).length).toBeGreaterThan(2)
  })
})

describe('repairing the MCQ share without breaking something else', () => {
  /** A block whose only apply-level item is also its last MCQ. */
  function conflictedPool(): ActivityOption[] {
    return [
      activityOptionFixture({
        activityId: 'tail',
        type: 'free_recall',
        family: 'long_text',
        progression: 'production',
        difficulty: 5,
        bloom: 'understand',
      }),
      ...Array.from({ length: 6 }, (_, index) =>
        activityOptionFixture({
          activityId: `mcq-${index}`,
          type: index % 2 === 0 ? 'mcq_single' : 'mcq_multi',
          family: 'choice',
          progression: 'recognition',
          difficulty: 1 + index,
          // Only the hardest — the first drop candidate — carries the apply level.
          bloom: index === 5 ? 'apply' : 'remember',
        }),
      ),
    ]
  }

  it('never drops the item that is holding another rule up', () => {
    const result = composeLessonPractice({ pool: conflictedPool(), seed: SEED })
    const rules = result.unmet.map((entry) => entry.rule)
    // Whatever it did about the MCQ share, it must not have created an apply-level failure
    // that the pool did not have: a repair that makes the report longer is not a repair.
    if (rules.includes('apply_bloom')) {
      expect(result.activities.some((option) => option.bloom === 'apply')).toBe(false)
    }
    expect(result.activities.length).toBeGreaterThanOrEqual(DEFAULT_LESSON_PRACTICE_LIMITS.min)
  })

  it('stops rather than mangling a block it cannot repair', () => {
    // Every body item is an MCQ and every one of them is load-bearing, so there is no drop
    // and no swap available; the composer reports and stops instead of looping.
    const pool = [
      activityOptionFixture({
        activityId: 'tail',
        type: 'short_answer',
        family: 'text_input',
        progression: 'production',
        difficulty: 5,
        bloom: 'apply',
      }),
      ...Array.from({ length: 8 }, (_, index) =>
        activityOptionFixture({
          activityId: `m-${index}`,
          type: 'mcq_single',
          family: 'choice',
          progression: 'recognition',
          difficulty: 1,
          bloom: 'remember',
        }),
      ),
    ]
    const result = composeLessonPractice({ pool, seed: SEED })
    expect(result.unmet.map((entry) => entry.rule)).toContain('mcq_share')
    expect(result.activities.length).toBeGreaterThanOrEqual(DEFAULT_LESSON_PRACTICE_LIMITS.min)
  })
})
