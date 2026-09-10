import type { Activity, AuthoredActivity, NewEntity, UnmetRule } from '@retenia/core'
import { composeLessonPractice } from '@retenia/core'
import { type GenerationWarning, warning } from '../schemas/warnings'

/**
 * The over-generation filter of `docs/spec/04-path-generation.md` §2: *"generate more and
 * filter"*, with §4's activity constraints as the filter.
 *
 * The rules themselves are `@retenia/core`'s `composeLessonPractice` — already implemented,
 * already property-tested over a thousand random pools, and until now with no production
 * caller. It enforces ≥ 3 distinct types, ≥ 3 distinct families, ≤ 40 % MCQ, ≥ 1 activity at
 * the apply level, a non-decreasing difficulty ramp and a production tail.
 *
 * Two things this adds.
 *
 * **The limits.** `DEFAULT_LESSON_PRACTICE_LIMITS` is 6–12, which is §12's *session* block;
 * §4's *lesson* block is "4–8 activities", so the caller passes those.
 *
 * **Reporting rather than throwing.** `composeLessonPractice` returns the best block a pool
 * allows plus the rules it could not meet, and that is what a thin lesson deserves: a pool of
 * eight multiple-choice questions cannot satisfy the 40 % cap, and failing the lesson over it
 * would abort a forty-lesson expansion for a content problem the author can see and fix. The
 * unmet rules land on `lessons.expansion` and in the panel.
 */

/** §4's "Activities per lesson: 4–8". */
export const LESSON_PRACTICE_LIMITS = Object.freeze({ min: 4, max: 8 })

export interface ComposedPractice {
  /** In the order they will be served; `ordinal` is the index. */
  readonly rows: readonly Omit<NewEntity<Activity>, 'lessonId'>[]
  readonly kept: number
  readonly generated: number
  readonly unmet: readonly UnmetRule[]
  readonly warnings: readonly GenerationWarning[]
}

export function composePractice(
  pool: readonly AuthoredActivity[],
  lessonSpecId: string,
  seed: string,
): ComposedPractice {
  if (pool.length === 0) {
    return {
      rows: [],
      kept: 0,
      generated: 0,
      unmet: [],
      warnings: [
        warning('practice_incomplete', { lesson: lessonSpecId, rule: 'count', detail: 'no pool' }),
      ],
    }
  }

  const byKey = new Map(pool.map((candidate) => [candidate.key, candidate]))
  const composed = composeLessonPractice({
    pool: pool.map((candidate) => candidate.option),
    seed,
    limits: LESSON_PRACTICE_LIMITS,
  })

  const rows = composed.activities.flatMap((option, index) => {
    const candidate = byKey.get(option.activityId)
    return candidate === undefined ? [] : [{ ...candidate.row, ordinal: index }]
  })

  const warnings = composed.unmet.map((unmet) =>
    warning('practice_incomplete', {
      lesson: lessonSpecId,
      rule: unmet.rule,
      detail: unmet.detail,
    }),
  )

  return {
    rows,
    kept: rows.length,
    generated: pool.length,
    unmet: composed.unmet,
    warnings,
  }
}
