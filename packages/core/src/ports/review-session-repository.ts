import type { ReviewSession } from '../entities'
import type { CrudRepository, ListOptions } from './audit'

/**
 * The daily session's persistence (`docs/spec/02-memory-system.md` §12).
 *
 * It exists for one reason: so closing the app mid-session does not lose the queue. The
 * scheduler's own state lives in `cards` and `review_logs` and is complete without this
 * table — what would be lost is only the *order* the user was working through and how far
 * they had got, which cannot be recovered by recomposing because recomposing would reorder
 * the queue under someone who is halfway through it.
 */
export interface ReviewSessionRepository extends CrudRepository<ReviewSession> {
  /**
   * The session still open, if there is one. At most one may be `in_progress` at a time —
   * `startSession` finds this first and resumes it rather than composing a second queue.
   * Newest first, so a stale row left by a crash never shadows a newer one.
   */
  findActive(): Promise<ReviewSession | undefined>
  /** Sessions started in `[from, to)`, newest first — the heatmap's and the streak's input. */
  listSince(from: Date, to?: Date, options?: ListOptions): Promise<ReviewSession[]>
  /**
   * Marks every `in_progress` session older than `before` as `abandoned`. A session the
   * user walked away from yesterday must not be resumed today: its plan was composed
   * against yesterday's due set. Returns how many were closed. Idempotent.
   */
  abandonStale(before: Date): Promise<number>
}
