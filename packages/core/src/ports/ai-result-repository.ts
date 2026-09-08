import type { AiResult } from '../entities'
import type { CrudRepository, NewEntity } from './audit'

/**
 * The idempotent result cache of `docs/spec/04-path-generation.md` §7: *"every call has
 * `custom_id = hash(stage, input_ids, prompt_version)`; if a result exists, it is not
 * repeated (key with the Batch API and for resuming after closing the app)"*.
 *
 * `AiCallRepository` is the cost log — every attempt, including the failed and the discarded
 * ones — and this is the answer store: at most one live row per unit of work, holding the
 * completion that was accepted. A caller reaches for this one to avoid paying twice, and for
 * that one to find out what a month cost.
 */
export interface AiResultRepository extends CrudRepository<AiResult> {
  /**
   * The cached answer, if there is one, **and the hit counted**.
   *
   * Counting inside the read rather than in a second call is what keeps "how much has the
   * cache saved" honest: a caller that fetched and forgot to record the hit would make the
   * saving look like zero, and there is no legitimate reason to look a `custom_id` up except
   * to use what it returns.
   */
  findByCustomId(customId: string): Promise<AiResult | undefined>
  /**
   * Store an answer, replacing whatever was there under the same `custom_id`.
   *
   * An upsert rather than an insert, because `force` (a "Regenerate" the user asked for) has
   * to be able to replace the answer it deliberately bypassed — otherwise the next run would
   * serve the stale one and the regeneration would look like it had not happened.
   */
  put(input: NewEntity<AiResult>): Promise<AiResult>
  /** Rows for one stage, newest first — what housekeeping and 7.5's dashboard enumerate. */
  listByStage(stage: string, options?: { limit?: number; offset?: number }): Promise<AiResult[]>
  /**
   * Soft-delete every entry for a stage, or for a stage at a given prompt version.
   *
   * The manual escape hatch behind "regenerate everything from this book": the `custom_id`
   * already invalidates on a prompt or schema change, so this exists for the cases the key
   * cannot see — a model that turned out to be producing rubbish, a bug in a task builder.
   * Returns how many rows it retired.
   */
  purge(query: { stage?: string; promptVersion?: string; before?: Date }): Promise<number>
}
