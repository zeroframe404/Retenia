import type { Source, SourceStatus, SourceUnit } from '../entities'
import type { CrudRepository, ListOptions, NewEntity } from './audit'

/**
 * The source library. Owns `sources` and their `source_units`, because a unit has no life
 * of its own: soft-deleting a source takes its units (and chunks) out of retrieval with it.
 */
export interface SourceRepository extends CrudRepository<Source> {
  /** The source that owns a given blob, if any. */
  findByBlobSha256(sha256: string): Promise<Source | undefined>
  listByStatus(status: SourceStatus, options?: ListOptions): Promise<Source[]>
  /** Marks ingestion finished: `status = 'ready'`, `ingestedAt = at`, `error = null`. */
  markIngested(id: string, at: Date): Promise<Source>
  /** Marks ingestion failed: `status = 'failed'`, `error = message`. */
  markFailed(id: string, message: string): Promise<Source>

  // --- source units ---
  findUnit(id: string): Promise<SourceUnit | undefined>
  listUnits(sourceId: string, options?: ListOptions): Promise<SourceUnit[]>
  createUnit(input: NewEntity<SourceUnit>): Promise<SourceUnit>
  /** Soft-deletes the source's current units and inserts these instead — what a re-parse
   *  does. Runs in one transaction. */
  replaceUnits(sourceId: string, units: readonly NewEntity<SourceUnit>[]): Promise<SourceUnit[]>
}
