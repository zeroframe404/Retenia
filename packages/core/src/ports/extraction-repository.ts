import type { Extraction } from '../entities'
import type { CrudRepository, ListOptions, NewEntity } from './audit'

/**
 * The per-chunk P1 results (sub-phase 8.1, `docs/spec/04-path-generation.md` §3 stage 3 and
 * §7's idempotency rule: *"if a result exists, it is not repeated"*).
 *
 * Keyed by `customId`, which is built from the chunk's identity and the prompt and schema
 * versions — so the same book extracted twice is one set of rows, and a reworded prompt is
 * a new set beside it rather than an overwrite.
 */
export interface ExtractionRepository extends CrudRepository<Extraction> {
  /** The live rows for these custom ids, in no particular order. Any number of ids. */
  findByCustomIds(customIds: readonly string[]): Promise<Extraction[]>
  listByChunkIds(chunkIds: readonly string[]): Promise<Extraction[]>
  listBySource(sourceId: string, options?: ListOptions): Promise<Extraction[]>
  /**
   * Store an answer, replacing whatever live row shares its `customId`.
   *
   * An upsert for the same reason `AiResultRepository.put` is one: a forced regeneration has
   * to be able to replace the answer it deliberately bypassed.
   */
  put(input: NewEntity<Extraction>): Promise<Extraction>
}
