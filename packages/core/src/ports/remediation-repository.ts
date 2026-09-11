import type { Remediation, RemediationStatus } from '../entities'
import type { CrudRepository, ListOptions } from './audit'

/**
 * The remediation log (`docs/spec/04-path-generation.md` §11, sub-phase 8.6): every trigger
 * that fired, what the limits made of it, and its measured effect.
 *
 * The limits read it — "1 active per module, 3 per week, dedupe by concept" are questions
 * about these rows — and so does threshold tuning, which is why refusals are kept.
 */
export interface RemediationRepository extends CrudRepository<Remediation> {
  /** Every remediation of one path version, oldest `createdAt` first. */
  listByPathVersion(pathVersionId: string, options?: ListOptions): Promise<Remediation[]>
  /** Every remediation in any of these statuses, across versions, oldest first. */
  listByStatus(
    statuses: readonly RemediationStatus[],
    options?: ListOptions,
  ): Promise<Remediation[]>
  /** Created at or after `from`, oldest first — the weekly limit's window. */
  listSince(from: Date, options?: ListOptions): Promise<Remediation[]>
  /** The remediation that wrote this lesson, if any. */
  findByLesson(lessonId: string): Promise<Remediation | undefined>
}
