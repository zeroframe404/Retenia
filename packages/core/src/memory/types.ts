import type { Card, CardState, Rating, ReviewLog } from '../entities'
import type { NewEntity } from '../ports/audit'

/**
 * The scheduler's vocabulary: the pluggable `Scheduler` port of
 * `docs/spec/02-memory-system.md` §15 and the types it speaks.
 *
 * Nothing here depends on `ts-fsrs`. `FsrsScheduler` is one implementation; the interface
 * is what the daily session composer, exam mode and the review use case program against,
 * so an FSRS variant ("-S", "-F") or an SM-2 shim for imports can be swapped in without
 * touching them (§17, risk 1).
 */

/** What `review_logs.algorithm_version` carries for every row this scheduler writes. */
export const SCHEDULER_ALGORITHM_VERSION = 'fsrs6'

/** `fsrs6` today; `sm2` is reserved for the import-only fallback (§6). */
export type SchedulerId = 'fsrs6' | 'sm2' | (string & Record<never, never>)

/** The four answer buttons. `Manual` (0) is a `Rating` but never a grade: it logs a
 *  postpone or a forget without touching S and D (`fsrs-rules`). */
export type Grade = Exclude<Rating, 0>

export const GRADES: readonly Grade[] = Object.freeze([1, 2, 3, 4] as const)

/** `ts-fsrs` `Rating`, by name. */
export const RATING = Object.freeze({
  Manual: 0,
  Again: 1,
  Hard: 2,
  Good: 3,
  Easy: 4,
} as const) satisfies Readonly<Record<string, Rating>>

/** `ts-fsrs` `State`, by name. */
export const CARD_STATE = Object.freeze({
  New: 0,
  Learning: 1,
  Review: 2,
  Relearning: 3,
} as const) satisfies Readonly<Record<string, CardState>>

export type TimeUnit = 'm' | 'h' | 'd'

/** A learning step as `ts-fsrs` spells it: `1m`, `10m`, `1h`, `1d`. */
export type StepUnit = `${number}${TimeUnit}`

/** JavaScript weekday: 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** §4 "Easy days": how much reviewing the user wants on a weekday. A missing day is
 *  `normal`. */
export type EasyDayLevel = 'normal' | 'reduced' | 'minimum'
export type EasyDays = Readonly<Partial<Record<Weekday, EasyDayLevel>>>

/**
 * §15: within the fuzz window the balancer picks the day with the fewest due cards. The
 * candidates are due instants (same time of day as the review, consecutive days); it must
 * return one of them, or the scheduler falls back to its own deterministic pick.
 */
export type LoadBalancer = (candidates: Date[]) => Date

/**
 * What an importance level or an exam asks of the scheduler for one review (§7, §15).
 * Importance changes exactly this — never S, D or the parameters (`fsrs-rules`).
 */
export interface SchedulingOptions {
  /** `request_retention`: `(0, 1]`; the spec allows 0.70–0.99 and defaults to 0.90. */
  desiredRetention: number
  /** `maximum_interval`, in days, at least 1. */
  maxIntervalDays: number
  learningSteps: readonly StepUnit[]
  relearningSteps: readonly StepUnit[]
  /** Spread day-based intervals inside the fuzz window (§3.2 (i)), seeded per card. */
  fuzz: boolean
  loadBalance?: LoadBalancer
  easyDays?: EasyDays
}

/** The DSR memory state of one card, without the calendar. */
export interface MemoryState {
  stability: number
  difficulty: number
}

/**
 * The FSRS half of a review log — everything the scheduler knows about a review. The use
 * case adds what it knows (`durationMs`, `context`, `exerciseScore`, `device`,
 * `attemptId`) and the repository mints the id and the audit set.
 */
export type ReviewLogDraft = Omit<
  NewEntity<ReviewLog>,
  'id' | 'durationMs' | 'context' | 'exerciseScore' | 'device' | 'attemptId'
>

/** One scheduling outcome: the card after the review and the log row describing it. */
export interface SchedulingResult {
  card: Card
  log: ReviewLogDraft
}

/** The outcome of each of the four buttons, for the "next interval" preview under them. */
export type SchedulingPreview = Readonly<Record<Grade, SchedulingResult>>

/** What `reschedule` replays: a stored `ReviewLog` satisfies it. */
export interface ReviewHistoryEntry {
  rating: Rating
  review: Date
}

/**
 * The pluggable scheduler (§15). Every method is pure: it reads the card it is given and
 * returns new objects; persisting them is the `reviewCard` use case's job.
 */
export interface Scheduler {
  readonly id: SchedulerId
  /** The four buttons at once, for the interval preview under each. */
  preview(card: Card, now: Date, options: SchedulingOptions): SchedulingPreview
  /** One button. */
  apply(card: Card, now: Date, grade: Grade, options: SchedulingOptions): SchedulingResult
  /** `R` at `at`: the probability of recalling the card then. 0 for a card never reviewed. */
  retrievability(card: Card, at: Date): number
  /** The closed-form `I(r, S)` in days, unrounded — what exam mode needs in O(1) (§8). */
  intervalFor(retention: number, state: Pick<MemoryState, 'stability'>): number
  /**
   * The card as it would be had its whole history been scheduled with `options` — after a
   * parameter change or an import (§14). Manual entries are skipped, as `ts-fsrs` does.
   */
  reschedule(card: Card, history: readonly ReviewHistoryEntry[], options: SchedulingOptions): Card
  /** The card before `log` was applied to it. */
  rollback(card: Card, log: ReviewLogDraft): Card
  /** Back to `New`, keeping or resetting `reps`/`lapses`. Logged with rating `Manual`. */
  forget(card: Card, now: Date, resetCounts: boolean): SchedulingResult
  /**
   * Move the due date without a review (overload protection, Mercy, a user's "later"):
   * S, D, `lastReview` and the counters stay; the log carries rating `Manual` (§7 rule 3).
   */
  postpone(card: Card, now: Date, due: Date): SchedulingResult
}
