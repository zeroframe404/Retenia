import type { AiBatch } from '../entities'
import type { CrudRepository, ListOptions, NewEntity } from './audit'

/**
 * Submitted Batch API jobs (`docs/spec/06-ai-providers.md` §2), so polling survives a restart.
 *
 * The third table in this family and the one that ties the other two together. `ai_calls` is
 * the cost log — one row per dispatched request, batched or not; `ai_results` is the answer
 * store keyed by `custom_id`; this is the *job*: what was sent, to whom, what it was quoted
 * at, and where the polling had got to when the app was last closed.
 *
 * Nothing here deletes: "what did last month's batches cost" is a question the usage
 * dashboard (7.5) has to be able to answer, and a finished batch is a few dozen bytes.
 */
export interface AiBatchRepository extends CrudRepository<AiBatch> {
  /**
   * Every batch that is not in a terminal status, oldest first.
   *
   * Read once at startup to pick up whatever the previous run left in flight, and again by
   * the tray. Ordered oldest first so a resumed run polls the batch that has been waiting
   * longest before the one submitted a minute ago.
   */
  listActive(): Promise<AiBatch[]>
  /** Finished batches, newest first — the usage dashboard's history. */
  listRecent(options?: ListOptions): Promise<AiBatch[]>
  /** Whatever the provider calls this job. Used when a poll answers before the row is read. */
  findByProviderBatchId(providerBatchId: string): Promise<AiBatch | undefined>
  create(input: NewEntity<AiBatch>): Promise<AiBatch>
}
