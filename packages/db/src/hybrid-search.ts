import type {
  Chunk,
  ChunkSearchHit,
  ChunkSearchOptions,
  RerankDocument,
  Reranker,
} from '@retenia/core'
import { parseSourceLocator } from '@retenia/core'
import type { Database } from 'better-sqlite3'
import {
  type FtsHit,
  ftsQuery,
  type KnnHit,
  knnChunks,
  searchChunksFts,
  type VectorPrecision,
} from './search'

/**
 * Hybrid retrieval, the pipeline of `docs/spec/05-ingestion-rag.md` §4:
 *
 * ```
 * top-50 BM25 ∪ top-50 vector → Reciprocal Rank Fusion → reranker → top-N
 * ```
 *
 * with `chunk_id → block_ids` carried through so the tutor can cite the exact page,
 * timestamp or block a claim came from.
 */

/**
 * Reciprocal Rank Fusion's smoothing constant (Cormack et al. 2009), the value
 * `docs/spec/05-ingestion-rag.md` §4 assumes.
 *
 * RRF rather than score normalisation because the two branches are not comparable:
 * `bm25()` is negative and lower-is-better, an L2 distance is positive and lower-is-better,
 * and min-max normalising either one per query is wildly unstable when a branch returns two
 * hits. RRF uses only the ordinal rank, which is exactly why it is the standard fusion here.
 */
export const RRF_K = 60

/** Candidates each branch contributes before fusion — the "top-50" of the spec. */
export const DEFAULT_CANDIDATES = 50

/** Hits returned when the caller does not say. */
export const DEFAULT_TOP_N = 10

// --- The vector index port -----------------------------------------------------------------

export interface VectorQuery {
  embedding: ArrayLike<number>
  /** Neighbours wanted. */
  k: number
  /** The embedding space. Vectors from another model are never comparable. */
  modelId: string
  /** Restrict to these sources. Absent = every source; empty = no source. */
  sourceIds?: readonly string[]
}

export interface VectorHit {
  chunkId: string
  sourceId: string
  /** Lower is closer. Only the ordering is used by the fusion. */
  distance: number
}

/**
 * The seam between hybrid search and whatever holds the vectors.
 *
 * v1 is sqlite-vec in the same file as everything else; past ~200k chunks
 * (`docs/spec/05-ingestion-rag.md` §3) the index moves to LanceDB, which is embedded, has
 * IVF-PQ/HNSW and its own rerankers. Everything above this interface — fusion, filters,
 * locators, the reranker hook — is storage-agnostic, so that swap is one new implementation
 * of `knn` and no change to the pipeline. Async for the same reason: LanceDB's API is.
 */
export interface VectorIndex {
  /** For logs and for "which index produced this order". */
  readonly name: string
  knn(query: VectorQuery): Promise<readonly VectorHit[]>
}

export interface SqliteVectorIndexOptions {
  /** Which of the two vec0 tables to scan; defaults to `int8` (see `knnChunks`). */
  precision?: VectorPrecision
  /** Candidates rescored exactly against the float vectors. */
  rescoreCandidates?: number
}

/** The sqlite-vec implementation: `embeddings_i8` scanned, `embeddings` rescored. */
export function createSqliteVectorIndex(
  sqlite: Database,
  options: SqliteVectorIndexOptions = {},
): VectorIndex {
  return {
    name: `sqlite-vec:${options.precision ?? 'int8'}`,
    knn: (query) =>
      Promise.resolve(
        knnChunks(sqlite, query.embedding, {
          k: query.k,
          modelId: query.modelId,
          sourceIds: query.sourceIds,
          precision: options.precision,
          rescoreCandidates: options.rescoreCandidates,
        }).map((hit: KnnHit) => ({
          chunkId: hit.chunkId,
          sourceId: hit.sourceId,
          distance: hit.distance,
        })),
      ),
  }
}

// --- The service ---------------------------------------------------------------------------

export interface HybridSearchDeps {
  sqlite: Database
  /** Hydrates chunk ids into entities — the repository's `findMany`, in one batched read. */
  loadChunks(ids: readonly string[]): Promise<readonly Chunk[]>
  /** Defaults to `createSqliteVectorIndex(sqlite)`. */
  vectorIndex?: VectorIndex
  /** Defaults to none, which is the same result as `passthroughReranker`. */
  reranker?: Reranker
  /** Per-branch candidates before fusion; defaults to `DEFAULT_CANDIDATES`. */
  candidates?: number
}

export interface HybridSearch {
  search(query: string, options: ChunkSearchOptions): Promise<ChunkSearchHit[]>
}

/** The sources a path was generated from (`paths.source_ids`, a JSON array). */
function pathSourceIds(sqlite: Database, pathId: string): readonly string[] {
  const row = sqlite
    .prepare('SELECT source_ids FROM paths WHERE id = ? AND deleted_at IS NULL')
    .get(pathId) as { source_ids: string } | undefined
  if (row === undefined) return []
  try {
    const parsed: unknown = JSON.parse(row.source_ids)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/**
 * Merges `sourceId`, `sourceIds` and `pathId` into one filter.
 *
 * `undefined` means "every source"; an empty array means "no source", which is what a
 * `pathId` naming a path with no sources (or no path at all) must produce — silently
 * searching the whole library instead would be a much worse answer than none.
 */
function resolveSourceIds(
  sqlite: Database,
  options: ChunkSearchOptions,
): readonly string[] | undefined {
  const filters: (readonly string[])[] = []
  if (options.sourceId !== undefined) filters.push([options.sourceId])
  if (options.sourceIds !== undefined) filters.push(options.sourceIds)
  if (options.pathId !== undefined) filters.push(pathSourceIds(sqlite, options.pathId))
  if (filters.length === 0) return undefined

  // Several filters intersect: "in this path AND in this source" is the library UI's own
  // reading of two active facets.
  let merged = new Set(filters[0] as readonly string[])
  for (const filter of filters.slice(1)) {
    const next = new Set(filter)
    merged = new Set([...merged].filter((id) => next.has(id)))
  }
  return [...merged]
}

interface Fused {
  chunkId: string
  score: number
  fts?: FtsHit
  vector?: VectorHit & { rank: number }
}

/** Σ 1/(k + rank) over the branches a chunk appears in, ranks 1-based. */
function fuse(ftsHits: readonly FtsHit[], vectorHits: readonly VectorHit[]): Fused[] {
  const fused = new Map<string, Fused>()

  const entry = (chunkId: string): Fused => {
    const existing = fused.get(chunkId)
    if (existing !== undefined) return existing
    const created: Fused = { chunkId, score: 0 }
    fused.set(chunkId, created)
    return created
  }

  for (const hit of ftsHits) {
    const target = entry(hit.chunkId)
    target.score += 1 / (RRF_K + hit.rank)
    target.fts = hit
  }
  for (const [index, hit] of vectorHits.entries()) {
    const rank = index + 1
    const target = entry(hit.chunkId)
    target.score += 1 / (RRF_K + rank)
    target.vector = { ...hit, rank }
  }

  // Ids are UUIDv7, so the tie-break is stable and tests are deterministic.
  return [...fused.values()].sort((left, right) =>
    left.score === right.score
      ? left.chunkId.localeCompare(right.chunkId)
      : right.score - left.score,
  )
}

/** What the reranker reads: the heading path gives a cross-encoder the context a bare
 *  400-token excerpt lacks. */
function rerankDocument(chunk: Chunk, score: number): RerankDocument {
  return {
    id: chunk.id,
    text: chunk.headingPath === null ? chunk.text : `${chunk.headingPath}\n\n${chunk.text}`,
    score,
  }
}

export function createHybridSearch(deps: HybridSearchDeps): HybridSearch {
  const vectorIndex = deps.vectorIndex ?? createSqliteVectorIndex(deps.sqlite)
  const perBranch = deps.candidates ?? DEFAULT_CANDIDATES

  function toHit(fused: Fused, chunk: Chunk, score: number): ChunkSearchHit {
    const sourceLocator = parseSourceLocator(chunk)
    return {
      chunk,
      score,
      fusionScore: fused.score,
      ...(fused.fts === undefined
        ? {}
        : {
            snippet: fused.fts.snippet,
            headingHighlight: fused.fts.headingHighlight,
            fts: { rank: fused.fts.rank, bm25: fused.fts.bm25 },
          }),
      ...(fused.vector === undefined
        ? {}
        : { vector: { rank: fused.vector.rank, distance: fused.vector.distance } }),
      sourceLocator,
      blockIds: sourceLocator.blockIds,
    }
  }

  return {
    async search(query, options): Promise<ChunkSearchHit[]> {
      const topN = options.k ?? DEFAULT_TOP_N
      if (topN <= 0) return []

      const sourceIds = resolveSourceIds(deps.sqlite, options)
      if (sourceIds !== undefined && sourceIds.length === 0) return []

      // A single-branch mode with no reranker needs no more rows than it returns; every other
      // shape wants the spec's 50 candidates so fusion and reranking have material to work on.
      const reranker = deps.reranker
      const branchLimit =
        options.mode === 'hybrid' || reranker !== undefined ? Math.max(perBranch, topN) : topN

      const runFts = options.mode !== 'vector'
      const runVector = options.mode !== 'fts'

      const ftsHits = runFts
        ? searchChunksFts(deps.sqlite, ftsQuery(query, { prefix: options.prefix }), {
            limit: branchLimit,
            sourceIds,
            snippetTokens: options.snippetTokens,
          })
        : []

      const vectorHits =
        runVector && 'embedding' in options
          ? await vectorIndex.knn({
              embedding: options.embedding,
              k: branchLimit,
              modelId: options.modelId,
              sourceIds,
            })
          : []

      const fused = fuse(ftsHits, vectorHits)
      if (fused.length === 0) return []

      // Hydrate only what can still make the cut; the reranker needs the text, so this comes
      // before it and after the fusion.
      const shortlist = fused.slice(0, Math.max(branchLimit, topN))
      const chunks = await deps.loadChunks(shortlist.map((entry) => entry.chunkId))
      const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]))
      const found = shortlist.filter((entry) => byId.has(entry.chunkId))

      if (reranker === undefined) {
        return found
          .slice(0, topN)
          .map((entry) => toHit(entry, byId.get(entry.chunkId) as Chunk, entry.score))
      }

      const ranked = await reranker.rerank(
        query,
        found.map((entry) => rerankDocument(byId.get(entry.chunkId) as Chunk, entry.score)),
        { topN },
      )
      const fusedById = new Map(found.map((entry) => [entry.chunkId, entry]))

      return ranked.flatMap((result) => {
        const entry = fusedById.get(result.id)
        const chunk = byId.get(result.id)
        // A reranker that invents an id is ignored rather than trusted.
        return entry === undefined || chunk === undefined ? [] : [toHit(entry, chunk, result.score)]
      })
    },
  }
}
