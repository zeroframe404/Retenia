import type { Card, Exam, ImportanceLevel, KnowledgeItem } from '../entities'
import {
  type ExamOverrideSource,
  type ExamSchedulingOverride,
  examOverrideFor,
  NO_EXAM_OVERRIDES,
} from './exam-override'
import {
  DEFAULT_IMPORTANCE_CATALOG,
  DEFAULT_IMPORTANCE_LEVEL,
  type ImportanceCatalog,
  type ImportanceLevelSettings,
  URGENT_MODE_RETENTION,
  URGENT_MODE_STEPS,
} from './importance'
import { assertSchedulingOptions, DEFAULT_SCHEDULING_OPTIONS } from './parameters'
import { type DayBoundary, resolveDayBoundary } from './study-day'
import type { SchedulingOptions, StepUnit } from './types'

/**
 * Where a review's `SchedulingOptions` come from
 * (`docs/spec/02-memory-system.md` §7 rule 1, §8).
 *
 * Precedence, highest first:
 *
 * 1. the **exam** driving the card — "the exam wins" (§7 rule 1);
 * 2. an active **urgent mode** override — the temporary 48–72 h push of §7 rule 5;
 * 3. the card's own `importanceOverride`;
 * 4. its item's `importance`;
 * 5. `Normal`, when the item is gone.
 *
 * What comes out is only ever a *request*: retention, an interval cap and the learning
 * steps. Nothing here writes, and nothing here touches S or D — a level change moves no due
 * date, it changes what the **next** review aims at (§7 rule 2, Anki's "reschedule cards on
 * change = off"). `rescheduleNow` in `./reschedule.ts` is the explicit opt-in.
 */

export interface SchedulingPolicyInput {
  card: Card
  /** The card's knowledge item, when it still exists — the importance lives there. */
  item: KnowledgeItem | null
  now: Date
  /** The exam driving this card, when the caller already loaded it. Otherwise the policy's
   *  own `ExamOverrideSource` is consulted. */
  exam?: Exam | null
}

export interface SchedulingPolicy {
  optionsFor(input: SchedulingPolicyInput): SchedulingOptions | Promise<SchedulingOptions>
}

/** Which of the five rungs of the precedence ladder supplied the level. */
export type ImportanceSource = 'exam' | 'urgent_mode' | 'card_override' | 'item' | 'default'

/**
 * Everything the policy worked out, not just the options.
 *
 * `optionsFor` returns the narrow `SchedulingOptions` the `Scheduler` port speaks; the
 * daily session composer (4.3) and the review screen (4.4) need the rest — which level won
 * and why, whether the card is queued at all, and whether the final drill is on.
 */
export interface ImportanceResolution {
  level: ImportanceLevel
  source: ImportanceSource
  settings: ImportanceLevelSettings
  options: SchedulingOptions
  /** `false` for `paused`: out of the queue, though the clock keeps running (§7). */
  queued: boolean
  /** Urgent mode turns §12 step 6 on: everything graded Again/Hard comes back at the end. */
  finalDrill: boolean
  exam: ExamSchedulingOverride | null
  /** When the card's temporary override lapses; `null` for a permanent one or none. */
  urgentModeExpiresAt: Date | null
}

/**
 * One `SchedulingOptions` object per distinct request.
 *
 * `FsrsScheduler` remembers a validated cache key per options *object* (a `WeakMap` in
 * `keyFor`) before falling back to deriving one, so handing it the same object for the same
 * resolution skips both the re-validation and the allocation on every single review.
 */
function createOptionsCache(base: SchedulingOptions) {
  const cache = new Map<string, SchedulingOptions>()
  return (
    desiredRetention: number,
    maxIntervalDays: number,
    steps: readonly StepUnit[] | null,
  ): SchedulingOptions => {
    const key = `${desiredRetention}|${maxIntervalDays}|${steps === null ? '' : steps.join(',')}`
    let options = cache.get(key)
    if (options === undefined) {
      options = assertSchedulingOptions({
        ...base,
        desiredRetention,
        maxIntervalDays,
        ...(steps === null ? {} : { learningSteps: steps, relearningSteps: steps }),
      })
      cache.set(key, options)
    }
    return options
  }
}

export interface ImportancePolicyDeps {
  /** Defaults to §7's seeded numbers, so a policy works with no database. */
  catalog?: ImportanceCatalog
  /**
   * The steps, fuzz and load balancing the user's scheduler profile asks for. The level
   * supplies `desiredRetention` and `maxIntervalDays` on top; everything else is carried
   * through unchanged.
   */
  base?: SchedulingOptions
  /** The §8 layer. Defaults to none — every card falls through to its level. */
  exams?: ExamOverrideSource
  /** The study-day boundary an inline `input.exam` is measured against. Defaults to UTC
   *  with the 4 a.m. cutover, like everything else in the module. */
  dayBoundary?: Partial<DayBoundary>
  /** Internal: the memoized options builder `createImportanceSchedulingPolicy` shares
   *  across calls. A bare `resolveImportance` builds a throwaway one. */
  optionsFor?: (
    desiredRetention: number,
    maxIntervalDays: number,
    steps: readonly StepUnit[] | null,
  ) => SchedulingOptions
}

/**
 * True while a card is in urgent mode: an override at the **`urgent`** level, with an
 * expiry that has not passed.
 *
 * The level matters. `cards.overrideImportance` is the general form and accepts an expiry
 * with any level, so a temporary `maintenance` override is a legitimate thing to ask for —
 * and it must schedule at 0.85, not be silently promoted to urgent mode's 0.97 just for
 * being temporary.
 *
 * The expiry is honoured on read as well as swept (`expireUrgentMode`), so a missed sweep —
 * the app was closed for a week — can never leave a card reviewing at DR 0.97.
 */
export function isUrgentModeActive(card: Card, now: Date): boolean {
  return (
    card.importanceOverride === 'urgent' &&
    card.importanceOverrideExpiresAt !== null &&
    card.importanceOverrideExpiresAt.getTime() > now.getTime()
  )
}

/** The card's override, ignoring one that has expired. */
function liveOverride(card: Card, now: Date): ImportanceLevel | null {
  if (card.importanceOverride === null) return null
  if (card.importanceOverrideExpiresAt === null) return card.importanceOverride
  return card.importanceOverrideExpiresAt.getTime() > now.getTime() ? card.importanceOverride : null
}

/** The level that governs the card, and which rung supplied it. */
function effectiveLevel(
  card: Card,
  item: KnowledgeItem | null,
  now: Date,
): { level: ImportanceLevel; source: Exclude<ImportanceSource, 'exam'> } {
  const override = liveOverride(card, now)
  if (override !== null) {
    return {
      level: override,
      source: isUrgentModeActive(card, now) ? 'urgent_mode' : 'card_override',
    }
  }
  if (item !== null) return { level: item.importance, source: 'item' }
  return { level: DEFAULT_IMPORTANCE_LEVEL, source: 'default' }
}

/**
 * Resolve one card's scheduling request.
 *
 * `paused` stores no retention and no cap: it is "out of the queue", not "unschedulable".
 * It borrows `Normal`'s numbers so that a card reviewed by hand still schedules sanely, and
 * carries `queued: false` so the session composer leaves it alone.
 */
export function resolveImportance(
  input: SchedulingPolicyInput,
  deps: ImportancePolicyDeps = {},
): ImportanceResolution {
  const catalog = deps.catalog ?? DEFAULT_IMPORTANCE_CATALOG
  const base = deps.base ?? DEFAULT_SCHEDULING_OPTIONS
  const examSource = deps.exams ?? NO_EXAM_OVERRIDES
  const { card, item, now } = input

  const { level, source: levelSource } = effectiveLevel(card, item, now)
  const settings = catalog.get(level)
  const fallback = catalog.get(DEFAULT_IMPORTANCE_LEVEL)

  // An `exam` the caller already loaded short-circuits the source; `null` says explicitly
  // "no exam", which is not the same as "I did not look" (`undefined`).
  const exam =
    input.exam === undefined
      ? examSource.forCard(card, now)
      : input.exam === null
        ? null
        : examOverrideFor(card, input.exam, now, resolveDayBoundary(deps.dayBoundary ?? {}))

  const urgentMode = levelSource === 'urgent_mode'

  // The level's own numbers, with `paused` borrowing Normal's (it stores NULLs).
  const levelRetention = settings.desiredRetention ?? (fallback.desiredRetention as number)
  const levelCap = settings.maxIntervalDays ?? (fallback.maxIntervalDays as number)

  // Urgent mode raises the retention; the exam beats both (§7 rule 1).
  const requested = urgentMode ? Math.max(levelRetention, URGENT_MODE_RETENTION) : levelRetention
  const desiredRetention = exam === null ? requested : exam.desiredRetention
  // Two caps are a conjunction, not a choice: neither may be exceeded.
  const maxIntervalDays = exam === null ? levelCap : Math.min(levelCap, exam.maxIntervalDays)

  const options = (deps.optionsFor ?? createOptionsCache(base))(
    desiredRetention,
    maxIntervalDays,
    urgentMode ? URGENT_MODE_STEPS : null,
  )

  return {
    level,
    source: exam === null ? levelSource : 'exam',
    settings,
    options,
    queued: settings.queued,
    finalDrill: urgentMode,
    exam,
    urgentModeExpiresAt: urgentMode ? card.importanceOverrideExpiresAt : null,
  }
}

/** The real policy: §7's levels, §7 rule 5's urgent mode and §8's exam layer. */
export function createImportanceSchedulingPolicy(
  deps: ImportancePolicyDeps = {},
): SchedulingPolicy {
  const shared: ImportancePolicyDeps = {
    ...deps,
    optionsFor: deps.optionsFor ?? createOptionsCache(deps.base ?? DEFAULT_SCHEDULING_OPTIONS),
  }
  return { optionsFor: (input) => resolveImportance(input, shared).options }
}

/** The full resolution, over the same shared caches — what the daily session composer and
 *  the review screen want. */
export function createImportanceResolver(
  deps: ImportancePolicyDeps = {},
): (input: SchedulingPolicyInput) => ImportanceResolution {
  const shared: ImportancePolicyDeps = {
    ...deps,
    optionsFor: deps.optionsFor ?? createOptionsCache(deps.base ?? DEFAULT_SCHEDULING_OPTIONS),
  }
  return (input) => resolveImportance(input, shared)
}

/** The same options for every card — what tests and the `Normal` baseline want. */
export function createDefaultSchedulingPolicy(
  options: SchedulingOptions = DEFAULT_SCHEDULING_OPTIONS,
): SchedulingPolicy {
  const resolved = assertSchedulingOptions(options)
  return { optionsFor: () => resolved }
}
