import type { Chunk } from '../entities'
import type { CrudRepository, ListOptions, NewEntity } from './audit'

export type SearchMode = 'fts' | 'vector' | 'hybrid'

interface SearchOptionsBase {
  /** How many hits to return. Defaults to 10. */
  k?: number
  /** Restrict to one source. */
  sourceId?: string
}

/**
 * Search options. The repository cannot embed text — it has no AI provider — so the
 * vector and hybrid modes carry the query vector the caller already computed, and the
 * type system makes forgetting it impossible.
 */
export type ChunkSearchOptions =
  | (SearchOptionsBase & {
      mode: 'fts'
      /** Approximate snippet length in tokens; defaults to 24. */
      snippetTokens?: number
    })
  | (SearchOptionsBase & {
      mode: 'vector' | 'hybrid'
      embedding: ArrayLike<number>
      /** Distances across embedding spaces are meaningless, so the model is required. */
      modelId: string
      snippetTokens?: number
    })

export interface ChunkSearchHit {
  chunk: Chunk
  /** Comparable within one result set only: BM25 for `fts`, similarity for `vector`,
   *  the reciprocal-rank-fusion score for `hybrid`. Higher is better in every mode. */
  score: number
  /** The matching passage with `<b>…</b>` around the hits; only for modes that ran FTS. */
  snippet?: string
  fts?: { rank: number }
  vector?: { distance: number }
}

/**
 * The retrieval-sized slices of a source. `search` composes the FTS5 index and the vector
 * index; the local reranker on top of it is sub-phase 3.3
 * (`docs/spec/05-ingestion-rag.md` §4).
 */
export interface ChunkRepository extends CrudRepository<Chunk> {
  listBySource(sourceId: string, options?: ListOptions): Promise<Chunk[]>
  findByHash(hash: string): Promise<Chunk[]>
  /** Bulk insert for an ingestion run; one transaction. */
  createMany(inputs: readonly NewEntity<Chunk>[]): Promise<Chunk[]>
  search(query: string, options: ChunkSearchOptions): Promise<ChunkSearchHit[]>
}
