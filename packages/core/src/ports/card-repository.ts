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
export interface CardRepository extends CrudRepository<Card> {
  /**
   * Live, unsuspended cards whose `due` has passed and whose burial has expired, ordered by
   * importance rank, then `due` ascending, then id (deterministic, so tests and the session
   * composer see a stable sequence).
   */
  findDue(now: Date, filters?: DueFilters): Promise<Card[]>
  findByItem(itemId: string, options?: ListOptions): Promise<Card[]>
  listByExam(examId: string, options?: ListOptions): Promise<Card[]>
  /** Upserts many cards in one transaction — what a review batch or an import writes. */
  bulkSave(cards: readonly SaveEntity<Card>[]): Promise<void>
  /** Live cards per effective importance level, for the load and overload displays. Every
   *  level is present in the result, zeroes included. */
  countByImportance(options?: ImportanceCountOptions): Promise<Record<ImportanceLevel, number>>
  setSuspended(id: string, suspended: boolean): Promise<Card>
  /** `until = null` un-buries. */
  buryUntil(id: string, until: Date | null): Promise<Card>
  setLeech(id: string, leech: boolean): Promise<Card>
}
