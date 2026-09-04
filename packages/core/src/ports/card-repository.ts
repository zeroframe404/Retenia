import type { Card, CardState, ImportanceLevel } from '../entities'
import type { CrudRepository, ListOptions, SaveEntity } from './audit'

export interface DueFilters {
  /** Filters on the *effective* importance: `card.importanceOverride ?? item.importance`. */
  importance?: readonly ImportanceLevel[]
  /** `paused` is out of the queue by design; opt in explicitly to see it. */
  includePaused?: boolean
  /** `null` matches cards with no exam attached; a string matches that exam. */
  examId?: string | null
  states?: readonly CardState[]
  limit?: number
}

export interface ImportanceCountOptions {
  /** Count only cards due at or before this instant. Omit to count every live card. */
  dueBefore?: Date
  /** Count suspended cards too. Off by default. */
  includeSuspended?: boolean
  /** Count cards buried past `at`. Off by default; requires `dueBefore` to mean anything. */
  includeBuried?: boolean
}

/**
 * The scheduler's window onto the database.
 *
 * `findDue` answers "what is eligible right now", nothing more: quotas, interleaving,
 * overload protection and the final drill are the daily session composer's job
 * (sub-phase 4.3, `docs/spec/02-memory-system.md` §9).
 */
/**
 * The three columns the forecast needs, and nothing else (§13's "Forecast" row).
 *
 * A projection rather than whole cards on purpose: a 90-day forecast touches most of the
 * collection, and reading every payload and FSRS column to count rows would make the cheapest
 * screen in the app the most expensive.
 */
export interface DueProjection {
  due: Date
  /** The card's *effective* importance, override and expiry applied. */
  level: ImportanceLevel
  state: CardState
}

export interface CardRepository extends CrudRepository<Card> {
  /**
   * Live, unsuspended cards whose `due` has passed and whose burial has expired, ordered by
   * `due` ascending, then id (deterministic, so tests and the session composer see a stable
   * sequence). Ordering by importance is the composer's job, not a column the index can
   * serve — see the adapter.
   */
  findDue(now: Date, filters?: DueFilters): Promise<Card[]>
  /**
   * Live, unsuspended cards due in `[from, to)`, oldest first — what the forecast buckets by
   * day. `paused` is excluded like everywhere else; `limit` bounds the read.
   */
  listDueBetween(from: Date, to: Date, options?: { limit?: number }): Promise<DueProjection[]>
  findByItem(itemId: string, options?: ListOptions): Promise<Card[]>
  /** Every live card of every one of these items — what urgent mode and a bulk importance
   *  change operate on. */
  listByItems(itemIds: readonly string[], options?: ListOptions): Promise<Card[]>
  listByExam(examId: string, options?: ListOptions): Promise<Card[]>
  /** Upserts many cards in one transaction — what a review batch or an import writes. */
  bulkSave(cards: readonly SaveEntity<Card>[]): Promise<void>
  /** Live cards per effective importance level, for the load and overload displays. Every
   *  level is present in the result, zeroes included. */
  countByImportance(options?: ImportanceCountOptions): Promise<Record<ImportanceLevel, number>>
  /**
   * Sets (or clears, with `level: null`) the per-card importance override on many cards at
   * once. `expiresAt` makes it temporary — that is what urgent mode is (§7 rule 5); `null`
   * makes it permanent.
   *
   * Never touches `due`, `stability`, `difficulty` or any other FSRS column: changing the
   * level changes what the **next** review asks for, nothing that is already scheduled
   * (§7 rule 2). Returns how many cards were written.
   */
  overrideImportance(
    ids: readonly string[],
    level: ImportanceLevel | null,
    expiresAt?: Date | null,
  ): Promise<number>
  /** Clears every override whose `importanceOverrideExpiresAt` has passed — the urgent-mode
   *  sweep. Returns how many. Idempotent. */
  clearExpiredOverrides(now: Date): Promise<number>
  setSuspended(id: string, suspended: boolean): Promise<Card>
  /** `until = null` un-buries. */
  buryUntil(id: string, until: Date | null): Promise<Card>
  setLeech(id: string, leech: boolean): Promise<Card>
}
