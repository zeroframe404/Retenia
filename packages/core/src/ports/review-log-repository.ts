import type { ReviewContext, ReviewLog } from '../entities'
import type { ListOptions, NewEntity } from './audit'

/**
 * The FSRS history. **Append-only** — deliberately not a `CrudRepository`: there is no
 * `update` and no `save` to call, because a rewritten review would corrupt the optimizer's
 * training set and make `rollback` unsound. The schema enforces the same rule
 * (`CHECK (updated_at = created_at AND version = 1)`), so an adapter that got this wrong
 * would fail at the database too.
 */
export interface ReviewLogRepository {
  append(input: NewEntity<ReviewLog>): Promise<ReviewLog>
  appendMany(inputs: readonly NewEntity<ReviewLog>[]): Promise<ReviewLog[]>
  findById(id: string): Promise<ReviewLog | undefined>
  /** Oldest first, so a caller can replay them. */
  listByCard(cardId: string, options?: ListOptions): Promise<ReviewLog[]>
  /** Reviews in `[from, to)`, oldest first — the optimizer's and the statistics' input. */
  listSince(from: Date, to?: Date, options?: ListOptions): Promise<ReviewLog[]>
  /** The most recent review of a card, for `rollback`. */
  findLastByCard(cardId: string): Promise<ReviewLog | undefined>
  countByCard(cardId: string): Promise<number>
  /**
   * The median `durationMs` over the graded reviews in the window — the daily session
   * composer's "how long does a card take me" (§12). `null` when the window holds no
   * review that recorded a duration, and the caller falls back to the spec's 8 s.
   *
   * Rating `Manual` rows are excluded: a postpone is not a review and takes no time.
   */
  medianDurationMs(options?: {
    /** Oldest review to consider. Omit for the whole history. */
    from?: Date
    /** Restrict to these contexts. Omit for every context. */
    contexts?: readonly ReviewContext[]
  }): Promise<number | null>
  /**
   * The only mutation the append-only rule permits: set `deletedAt`, leaving `updatedAt`
   * and `version` untouched. Used when the parent card is soft-deleted, so the history
   * disappears with it without being rewritten. Returns how many rows were touched.
   */
  softDeleteForCard(cardId: string, deletedAt: Date): Promise<number>
  /**
   * The single-row form of `softDeleteForCard`, and the only thing "undo" is allowed to do
   * to a review (`.claude/skills/fsrs-rules/SKILL.md`: rows are never updated or deleted).
   * The card itself is restored with `Scheduler.rollback`; this just takes the log out of
   * the optimizer's training set and the statistics.
   *
   * Returns `false` when the row does not exist or was already soft-deleted, so undoing
   * twice is a no-op rather than an error.
   */
  softDeleteById(id: string, deletedAt: Date): Promise<boolean>
}
