import { describe, expect, it } from 'vitest'
import type { ActivityFamily, BloomLevel, ProgressionStage } from '../entities'
import { mulberry32 } from '../memory/prng'
import { activityOptionFixture, cardEntryFixture } from '../testing/activity-fixtures'
import type { ActivityOption } from './activity-option'
import { EMPTY_ACTIVITY_HISTORY, selectActivity } from './activity-selection'
import type { LessonPracticeRule } from './lesson-practice'
import {
  composeLessonPractice,
  isMcq,
  DEFAULT_LESSON_PRACTICE_LIMITS as LIMITS,
} from './lesson-practice'
import { stageForEntry, stageLadder } from './progression'

/**
 * Property tests over 1,000 randomly generated pools.
 *
 * The interesting property is **not** "every variety rule holds" — an all-MCQ lesson makes
 * that unachievable, and a test that only ran on satisfiable pools would prove nothing. What
 * is asserted instead is that the composer's own report is *honest*, in both directions:
 *
 * - **Soundness** — a rule the composer does *not* list as unmet really does hold, checked
 *   by predicates written here from the rule statements rather than by calling the
 *   composer's own checker.
 * - **Justification** — a rule the composer *does* list as unmet was genuinely unreachable
 *   from the pool it was given.
 *
 * Together they close both cheats: a composer that declared everything unmet would fail
 * justification, and one that declared everything met would fail soundness.
 */

const CASES = 1000
const random = mulberry32(0x5eed)

const FAMILIES: readonly ActivityFamily[] = [
  'choice',
  'cloze',
  'text_input',
  'pairs',
  'ordering',
  'categorize',
  'text_mark',
  'long_text',
  'cards',
  'disclosure',
]
const TYPES = [
  'mcq_single',
  'mcq_multi',
  'true_false',
  'cloze_typed',
  'cloze_wordbank',
  'short_answer',
  'matching_pairs',
  'ordering_sequence',
  'categorize',
  'free_recall',
]
const STAGES: readonly ProgressionStage[] = ['recognition', 'assisted', 'production']
const BLOOMS: readonly BloomLevel[] = ['remember', 'understand', 'apply', 'analyze']
/** The boundaries around 6 and 12 get deliberate attention. */
const SIZES = [0, 1, 2, 3, 5, 6, 7, 11, 12, 13, 40]

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T
}

/**
 * Skewed on purpose. A uniform pool almost always satisfies every rule, so it would never
 * exercise the reporting path this test exists to check.
 */
function randomPool(index: number): ActivityOption[] {
  const size = pick(SIZES)
  const roll = random()
  const oneFamily = roll < 0.25 ? pick(FAMILIES) : null
  const twoFamilies = roll >= 0.25 && roll < 0.5 ? [pick(FAMILIES), pick(FAMILIES)] : null
  const allMcq = random() < 0.15
  const noProduction = random() < 0.2
  const allProduction = random() < 0.1
  const constantDifficulty = random() < 0.2 ? 1 + Math.floor(random() * 5) : null
  const noBloom = random() < 0.3

  return Array.from({ length: size }, (_, item) => {
    const family = oneFamily ?? (twoFamilies ? pick(twoFamilies) : pick(FAMILIES))
    const type = allMcq ? pick(['mcq_single', 'mcq_multi']) : pick(TYPES)
    const progression: ProgressionStage = allProduction
      ? 'production'
      : noProduction
        ? pick(['recognition', 'assisted'])
        : pick(STAGES)
    return activityOptionFixture({
      activityId: `p${index}-${String(item).padStart(3, '0')}`,
      type,
      family,
      progression,
      // Descending in pool order half the time, to catch a composer that just preserves the
      // order it was handed.
      difficulty:
        constantDifficulty ?? (random() < 0.5 ? 5 - (item % 5) : 1 + Math.floor(random() * 5)),
      bloom: noBloom ? null : pick(BLOOMS),
    })
  })
}

/** The rule statements, restated independently of the composer. */
const HOLDS: Record<LessonPracticeRule, (block: readonly ActivityOption[]) => boolean> = {
  count: (block) => block.length >= LIMITS.min && block.length <= LIMITS.max,
  distinct_types: (block) => new Set(block.map((o) => o.type)).size >= LIMITS.minDistinctTypes,
  family_variety: (block) => new Set(block.map((o) => o.family)).size >= LIMITS.minDistinctFamilies,
  mcq_share: (block) =>
    block.length === 0 || block.filter(isMcq).length / block.length <= LIMITS.maxMcqShare,
  media_cap: (block) => block.filter((o) => o.hasMedia).length <= LIMITS.maxMedia,
  apply_bloom: (block) =>
    block.some(
      (o) => o.bloom !== null && ['apply', 'analyze', 'evaluate', 'create'].includes(o.bloom),
    ),
  increasing_difficulty: (block) => {
    const body = block.slice(0, Math.max(0, block.length - 1))
    return body.every(
      (option, index) =>
        index === 0 || (option.difficulty ?? 3) >= (body[index - 1]?.difficulty ?? 3),
    )
  },
  production_last: (block) => block[block.length - 1]?.progression === 'production',
}

/** Why the pool could not have satisfied the rule. */
const UNREACHABLE: Record<LessonPracticeRule, (pool: readonly ActivityOption[]) => boolean> = {
  count: (pool) => pool.length < LIMITS.min,
  distinct_types: (pool) => new Set(pool.map((o) => o.type)).size < LIMITS.minDistinctTypes,
  family_variety: (pool) => new Set(pool.map((o) => o.family)).size < LIMITS.minDistinctFamilies,
  // Even a minimum-size block needs this many non-MCQ activities.
  mcq_share: (pool) =>
    pool.filter((o) => !isMcq(o)).length < Math.ceil(LIMITS.min * (1 - LIMITS.maxMcqShare)),
  // The composer budgets media as it builds, so it can never overspend.
  media_cap: () => false,
  apply_bloom: (pool) =>
    !pool.some(
      (o) => o.bloom !== null && ['apply', 'analyze', 'evaluate', 'create'].includes(o.bloom),
    ),
  /**
   * The ramp has to end on the production tail, so it can only hold if the pool has a full
   * block's worth of items no harder than the hardest production activity in it. When it
   * does not, "production last" and "increasing difficulty" are in direct conflict, and §12
   * states the tail rule the more concretely — so the ramp is the one reported.
   */
  increasing_difficulty: (pool) => {
    if (pool.length < LIMITS.min) return true
    const production = pool.filter((o) => o.progression === 'production')
    if (production.length === 0) return true
    const hardestTail = Math.max(...production.map((o) => o.difficulty ?? 3))
    const rampSafe = pool.filter((o) => (o.difficulty ?? 3) <= hardestTail)
    // Not enough items no harder than the tail to fill a block at all.
    if (rampSafe.length < LIMITS.min) return true
    // Or: a ramp-safe block exists but would be over the MCQ share, so the two rules are in
    // genuine conflict and the composer had to break one of them.
    const nonMcqNeeded = LIMITS.min - Math.floor(LIMITS.min * LIMITS.maxMcqShare)
    return rampSafe.filter((o) => !isMcq(o)).length < nonMcqNeeded
  },
  production_last: (pool) => !pool.some((o) => o.progression === 'production'),
}

describe('composeLessonPractice over 1,000 random pools', () => {
  it('never throws, and always returns a subset of the pool', () => {
    for (let index = 0; index < CASES; index++) {
      const pool = randomPool(index)
      const { activities } = composeLessonPractice({ pool, seed: `s${index}` })
      const ids = new Set(pool.map((option) => option.activityId))
      expect(activities.length).toBeLessThanOrEqual(Math.max(LIMITS.max, 0))
      expect(activities.length).toBeLessThanOrEqual(pool.length)
      expect(new Set(activities.map((o) => o.activityId)).size).toBe(activities.length)
      for (const option of activities) expect(ids.has(option.activityId)).toBe(true)
    }
  })

  it('reports honestly: every rule it claims is met really is', () => {
    for (let index = 0; index < CASES; index++) {
      const pool = randomPool(index)
      const result = composeLessonPractice({ pool, seed: `s${index}` })
      const reported = new Set(result.unmet.map((entry) => entry.rule))
      for (const [rule, holds] of Object.entries(HOLDS) as [
        LessonPracticeRule,
        (block: readonly ActivityOption[]) => boolean,
      ][]) {
        if (reported.has(rule)) continue
        expect(
          holds(result.activities),
          `pool ${index}: "${rule}" was not reported unmet but does not hold`,
        ).toBe(true)
      }
    }
  })

  it('reports honestly: every rule it claims is unmet was genuinely unreachable', () => {
    for (let index = 0; index < CASES; index++) {
      const pool = randomPool(index)
      const result = composeLessonPractice({ pool, seed: `s${index}` })
      for (const entry of result.unmet) {
        expect(
          UNREACHABLE[entry.rule](pool),
          `pool ${index}: "${entry.rule}" was reported unmet but the pool could have met it.\n` +
            `pool (${pool.length}): ${JSON.stringify(
              pool.map((o) => [o.type, o.family, o.progression, o.difficulty, o.bloom]),
            )}\nchosen: ${JSON.stringify(
              result.activities.map((o) => [o.type, o.progression, o.difficulty]),
            )}`,
        ).toBe(true)
      }
    }
  })

  it('composes identically for the same seed', () => {
    for (let index = 0; index < CASES; index++) {
      const pool = randomPool(index)
      const a = composeLessonPractice({ pool, seed: `s${index}` })
      const b = composeLessonPractice({ pool, seed: `s${index}` })
      expect(a.activities.map((o) => o.activityId)).toEqual(b.activities.map((o) => o.activityId))
    }
  })
})

describe('selectActivity over 1,000 random pools', () => {
  it('never returns something the ladder forbids, and never throws', () => {
    for (let index = 0; index < CASES; index++) {
      const pool = randomPool(index)
      const stability = random() < 0.5 ? random() * 3 : random() * 120
      const entry = cardEntryFixture({
        stability,
        cardId: `019a0000-0000-7000-8000-${String(index).padStart(12, '0')}`,
      })
      const chosen = selectActivity({
        entry,
        options: pool,
        history: EMPTY_ACTIVITY_HISTORY,
        seed: `s${index}`,
        now: new Date('2026-06-01T12:00:00.000Z'),
      })
      if (chosen === null) continue
      const ladder = stageLadder(stageForEntry(entry))
      expect(ladder).toContain(chosen.option.progression)
      expect(chosen.option.eligible).toBe(true)
      expect(chosen.option.hasMedia).toBe(false)
    }
  })

  it('never offers recognition to a high-stability skill', () => {
    // The acceptance rule, asserted across every random pool rather than one fixture.
    for (let index = 0; index < CASES; index++) {
      const pool = randomPool(index)
      const entry = cardEntryFixture({
        stability: 22 + random() * 200,
        cardId: `019a0000-0000-7000-8000-${String(index).padStart(12, '0')}`,
      })
      const chosen = selectActivity({
        entry,
        options: pool,
        history: EMPTY_ACTIVITY_HISTORY,
        seed: `s${index}`,
        now: new Date('2026-06-01T12:00:00.000Z'),
      })
      expect(chosen?.option.progression).not.toBe('recognition')
    }
  })
})
