import type { Chunk, SourceLocator } from '../entities'
import type { CrudRepository, ListOptions, NewEntity } from './audit'

export type SearchMode = 'fts' | 'vector' | 'hybrid'

interface SearchOptionsBase {
  /** How many hits to return. Defaults to 10. */
  k?: number
  /** Restrict to one source. Merged with `sourceIds` when both are given. */
  sourceId?: string
  /** Restrict to a set of sources — the shape the library filter panel produces. */
  sourceIds?: readonly string[]
  /**
   * Restrict to the sources a path was generated from (`paths.source_ids`). A path with no
   * sources matches nothing rather than everything.
   */
  pathId?: string
  /** Approximate snippet length in tokens; defaults to 24. */
  snippetTokens?: number
  /**
   * Treat the last word as a prefix (`mitoc` matches `mitocondrias`), for type-ahead.
   * Off by default: a prefix term is much broader and skews BM25.
   */
  prefix?: boolean
}

/**
 * Search options. The repository cannot embed text — it has no AI provider — so the
 * vector and hybrid modes carry the query vector the caller already computed, and the
 * type system makes forgetting it impossible.
 */
export type ChunkSearchOptions =
  | (SearchOptionsBase & { mode: 'fts' })
  | (SearchOptionsBase & {
      mode: 'vector' | 'hybrid'
      embedding: ArrayLike<number>
      /** Distances across embedding spaces are meaningless, so the model is required. */
      modelId: string
    })

export interface ChunkSearchHit {
  chunk: Chunk
  /** Comparable within one result set only: the reciprocal-rank-fusion score, or the
   *  reranker's score when one ran. Higher is better in every mode. */
  score: number
  /** The fusion score before reranking — equal to `score` when no reranker ran. */
  fusionScore: number
  /** The matching passage with `<b>…</b>` around the hits; only for modes that ran FTS. */
  snippet?: string
  /** The chunk's heading path with `<b>…</b>` around the hits, when it matched too. */
  headingHighlight?: string
  /** Page or timestamp to open the source at, for the citation. */
  sourceLocator: SourceLocator
  /** `chunk_id → block_ids`: the source blocks this chunk covers (`sourceLocator.blockIds`). */
  blockIds: readonly string[]
  /** 1-based rank in the BM25 branch, with the raw `bm25()` value (lower is better). */
  fts?: { rank: number; bm25: number }
  /** 1-based rank in the vector branch, with the L2 distance (lower is closer). */
  vector?: { rank: number; distance: number }
}

/**
 * The retrieval-sized slices of a source. `search` composes the FTS5 index and the vector
 * index and fuses them with Reciprocal Rank Fusion, optionally reranked
 * (`docs/spec/05-ingestion-rag.md` §4).
 */
export interface ChunkRepository extends CrudRepository<Chunk> {
  listBySource(sourceId: string, options?: ListOptions): Promise<Chunk[]>
  findByHash(hash: string): Promise<Chunk[]>
  /** Bulk insert for an ingestion run; one transaction. */
  createMany(inputs: readonly NewEntity<Chunk>[]): Promise<Chunk[]>
  /**
   * What a re-chunk does, in one transaction: chunks whose `chunkKey` is in `inputs` are
   * updated in place — keeping their id, and therefore their embeddings and anything that
   * cites them — chunks whose key is gone are soft-deleted, and new keys are inserted.
   *
   * An input with a `null` `chunkKey` can never be matched, so it is always an insert; that is
   * the honest behaviour for a chunk with no stable identity, not a bug to work around.
   */
  replaceBySource(sourceId: string, inputs: readonly NewEntity<Chunk>[]): Promise<Chunk[]>
  /** Sources with at least one live chunk not written under `chunkingVersion` — the reindex
   *  sweep of sub-phase 6.2, run at startup when the rules or the tokenizer change. */
  sourceIdsNeedingRechunk(chunkingVersion: string): Promise<string[]>
  /** Sources that have at least one live chunk at all. The sweep above cannot see a source
   *  with *no* chunks — one whose chunk job failed, or one ingested before chunking existed —
   *  so it is the complement of this that finds them. */
  sourceIdsWithChunks(): Promise<string[]>
  /** Writes the contextual-retrieval context onto chunks by key, in one transaction. Returns
   *  how many rows changed; a key that no longer exists is skipped, not an error — the source
   *  may have been re-chunked while the job ran. */
  setContexts(
    sourceId: string,
    contexts: readonly { chunkKey: string; context: string }[],
  ): Promise<number>
  search(query: string, options: ChunkSearchOptions): Promise<ChunkSearchHit[]>
}
