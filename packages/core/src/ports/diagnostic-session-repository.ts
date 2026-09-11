import type { DiagnosticSession, DiagnosticSessionStatus } from '../entities'
import type { CrudRepository, ListOptions } from './audit'

/**
 * The prior-knowledge diagnostic's persistence (`docs/spec/04-path-generation.md` §10,
 * sub-phase 8.5).
 *
 * It exists so a diagnostic survives the app being closed — the answer log is replayed on
 * resume — and so a finished one keeps a record of what its result wrote, which is what undo
 * and deferred verification read.
 */
export interface DiagnosticSessionRepository extends CrudRepository<DiagnosticSession> {
  /**
   * The `in_progress` session of a path version, if there is one; soft-deleted rows never
   * count. Newest `startedAt` first, so a stale row a crash left behind never shadows a newer
   * session.
   */
  findActive(pathVersionId: string): Promise<DiagnosticSession | undefined>
  /** Every session of one path version, oldest `startedAt` first. */
  listByPathVersion(pathVersionId: string, options?: ListOptions): Promise<DiagnosticSession[]>
  /** Every session in a status, across path versions, oldest `startedAt` first. */
  listByStatus(status: DiagnosticSessionStatus, options?: ListOptions): Promise<DiagnosticSession[]>
}
