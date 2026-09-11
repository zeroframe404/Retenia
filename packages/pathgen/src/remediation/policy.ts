import type { ImportanceLevel, RemediationStatus } from '@retenia/core'
import { REOPEN_LAPSES, REOPEN_MEAN_R, REOPEN_WINDOW_DAYS } from '../diagnostic/verify'

/**
 * Every number `docs/spec/04-path-generation.md` §11 fixes, in one place, so the tuning the
 * remediation log exists for has one file to change.
 *
 * The memory rule is §10's deferred verification to the letter — "≥ 2 lapses in 14 days or
 * mean R < 0.7" — so it reads the same constants rather than restating them.
 */

export const DAY_MS = 86_400_000

export const REMEDIATION_POLICY = Object.freeze({
  /** "module reinforcement < 70 % on a concept". */
  reinforcementThreshold: 0.7,
  lapseWindowDays: REOPEN_WINDOW_DAYS,
  lapses: REOPEN_LAPSES,
  meanR: REOPEN_MEAN_R,
  /** "the same `misconception_id` failed twice". */
  misconceptionRepeats: 2,
  /** How far back a repeated misconception is looked for. §11 names no window; a month keeps
   *  a slip from last term from counting as "twice". */
  misconceptionWindowDays: 30,
  /** "1 active remediation per module". */
  maxActivePerModule: 1,
  /** "and 3 per week". */
  maxPerWeek: 3,
  weekMs: 7 * DAY_MS,
  /** "at the third remediation of a concept, suggest returning to the core lesson". */
  revisitCoreAt: 3,
  /** `docs/spec/01-decisions.md` §3: the detour "raises the priority in memory" — to `high`,
   *  for 14 days or until 2 clean reviews, whichever comes first. */
  boostLevel: 'high' as ImportanceLevel,
  boostDays: 14,
  boostCleanReviews: 2,
  /** "3–5 min". */
  minutes: Object.freeze({ min: 3, max: 5 }),
  /** §9 P11: "1 worked example + 3 items". */
  items: 3,
  /** How long after a detour its outcome is still measured. */
  outcomeWindowDays: 14,
})

export type RemediationPolicy = typeof REMEDIATION_POLICY

/**
 * The statuses that count as "a remediation was inserted" — against the weekly limit and the
 * third-of-a-concept rule. A refusal was never inserted; a failed one never reached the path.
 */
export const INSERTED_STATUSES: ReadonlySet<RemediationStatus> = new Set<RemediationStatus>([
  'active',
  'completed',
  'dismissed',
])

/**
 * What the weekly limit counts: every inserted detour, and every one P11 was paid to write and
 * failed. Leaving failures out would let a detour that keeps failing — after a billed call — be
 * retried without bound, with only the monthly cap (which may be off) standing in the way.
 */
export const WEEKLY_COUNTED_STATUSES: ReadonlySet<RemediationStatus> = new Set<RemediationStatus>([
  ...INSERTED_STATUSES,
  'failed',
])

/** The rating `ts-fsrs` calls Good: a review at or above it is clean. */
export const CLEAN_RATING = 3
