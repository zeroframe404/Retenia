import type { EmbeddingStatus, JsonObject, Source, SourceStatus, SourceUnit } from '../entities'
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

  // --- the vector index ---

  /**
   * Records where the source stands in the vector index, in one write
   * (`docs/spec/05-ingestion-rag.md` §3).
   *
   * `modelId` is the space its vectors are in and is only meaningful alongside
   * `status: 'ready'`; passing `null` with any other status is what a reindex does when it
   * drops the old vectors. `error` is cleared unless given, because every transition out of
   * `failed` means the previous reason no longer applies.
   */
  setEmbeddingState(
    id: string,
    state: { status: EmbeddingStatus; modelId?: string | null; error?: string | null },
  ): Promise<Source>
  /**
   * Sources that are not embedded in `modelId`'s space and have chunks to embed — the
   * reindex sweep of sub-phase 6.3, run at startup and whenever the embedding model changes.
   *
   * "Not embedded in this space" covers three populations at once, and missing any of them
   * leaves part of the library permanently unsearchable by vector: a source that has never
   * been embedded, one whose last run failed, and one embedded under a *different* model —
   * whose vectors must be dropped rather than queried alongside the new ones.
   */
  sourceIdsNeedingEmbedding(modelId: string): Promise<string[]>

  // --- reading progress (sub-phase 6.6) ---

  /** Where the reader left off (`{ page }` or `{ cfi }`) and when — the reader's own resume
   *  point and Home's "Continuar donde estaba". */
  recordProgress(id: string, locator: JsonObject, at: Date): Promise<Source>
  /** The most recently opened sources, most recent first. Never includes a source that has
   *  not been opened in a reader (`lastOpenedAt` still `null`). */
  listRecentlyOpened(limit: number): Promise<Source[]>

  // --- source units ---
  findUnit(id: string): Promise<SourceUnit | undefined>
  listUnits(sourceId: string, options?: ListOptions): Promise<SourceUnit[]>
  createUnit(input: NewEntity<SourceUnit>): Promise<SourceUnit>
  /** Soft-deletes the source's current units and inserts these instead — what a re-parse
   *  does. Runs in one transaction. */
  replaceUnits(sourceId: string, units: readonly NewEntity<SourceUnit>[]): Promise<SourceUnit[]>
}
