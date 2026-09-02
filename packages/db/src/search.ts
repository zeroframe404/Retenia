import type { Database } from 'better-sqlite3'

/**
 * Thin, typed access to the two virtual tables the raw migration creates over `chunks`:
 * the FTS5 index `chunks_fts` and the sqlite-vec index `embeddings`. Hybrid retrieval
 * (BM25 ∪ vector → reciprocal rank fusion → reranker) is sub-phase 3.3; these are the
 * primitives it composes.
 */

/** The vector space of `embeddings.embedding`: `float[768]` (EmbeddingGemma-300M's native
 * width; other models are truncated/projected to it by the embedding job). Changing it means
 * a new vec0 table in a new migration and a full reindex. */
export const EMBEDDING_DIMENSIONS = 768

/** The FTS5 tokenizer of `chunks_fts`: `corazon` matches `corazón`, case-insensitive. */
export const FTS_TOKENIZER = 'unicode61 remove_diacritics 2'

export interface FtsSearchOptions {
  limit?: number
  /** Restrict to one source. */
  sourceId?: string
  /** Approximate snippet length in tokens (FTS5 `snippet()`), default 24. */
  snippetTokens?: number
}

export interface FtsHit {
  chunkId: string
  sourceId: string
  /** FTS5 `bm25()` — lower is better. */
  rank: number
  /** The matching passage with `<b>…</b>` around hits. */
  snippet: string
}

/**
 * Turns free text into a safe FTS5 query: every word becomes a quoted phrase token (so
 * user input can never be parsed as FTS syntax) joined by implicit AND. `prefix` appends
 * `*` for type-ahead. Returns `''` when there is nothing to search for.
 */
export function ftsQuery(text: string, options: { prefix?: boolean } = {}): string {
  const tokens = text
    .split(/\s+/)
    .map((token) => token.replace(/"/g, '').trim())
    .filter((token) => token.length > 0)
  return tokens.map((token) => `"${token}"${options.prefix ? '*' : ''}`).join(' ')
}

/** Full-text search over chunk text and heading paths. `query` is raw FTS5 syntax — build
 * it with `ftsQuery()` unless you mean to expose operators. */
export function searchChunksFts(
  sqlite: Database,
  query: string,
  options: FtsSearchOptions = {},
): FtsHit[] {
  if (query.trim().length === 0) return []
  const limit = options.limit ?? 50
  const snippetTokens = options.snippetTokens ?? 24
  const sourceFilter = options.sourceId !== undefined ? 'AND source_id = @sourceId' : ''

  return sqlite
    .prepare<
      { query: string; limit: number; snippetTokens: number; sourceId?: string },
      { chunk_id: string; source_id: string; rank: number; snippet: string }
    >(
      `SELECT chunk_id, source_id, bm25(chunks_fts) AS rank,
              snippet(chunks_fts, 2, '<b>', '</b>', '…', @snippetTokens) AS snippet
         FROM chunks_fts
        WHERE chunks_fts MATCH @query ${sourceFilter}
        ORDER BY rank
        LIMIT @limit`,
    )
    .all({ query, limit, snippetTokens, sourceId: options.sourceId })
    .map((row) => ({
      chunkId: row.chunk_id,
      sourceId: row.source_id,
      rank: row.rank,
      snippet: row.snippet,
    }))
}

/** Packs a vector into the little-endian `float32` blob sqlite-vec expects. */
export function vectorToBlob(vector: ArrayLike<number>): Buffer {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new RangeError(
      `embedding must have ${EMBEDDING_DIMENSIONS} dimensions, got ${vector.length}`,
    )
  }
  const floats = vector instanceof Float32Array ? vector : Float32Array.from(vector)
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength)
}

export interface EmbeddingRow {
  /** UUIDv7. */
  id: string
  sourceId: string
  chunkId: string
  /** The model that produced the vector — never mix spaces in one query. */
  modelId: string
  embedding: ArrayLike<number>
}

/** Inserts one vector. Use inside a transaction for bulk loads. */
export function insertEmbedding(sqlite: Database, row: EmbeddingRow): void {
  sqlite
    .prepare(
      'INSERT INTO embeddings (id, source_id, chunk_id, model_id, embedding) VALUES (?, ?, ?, ?, ?)',
    )
    .run(row.id, row.sourceId, row.chunkId, row.modelId, vectorToBlob(row.embedding))
}

/** Removes the vectors of one chunk (all models). The vec0 index is derived data: unlike
 * domain tables it is deleted and rebuilt, never soft-deleted. */
export function deleteEmbeddingsForChunk(sqlite: Database, chunkId: string): number {
  return sqlite.prepare('DELETE FROM embeddings WHERE chunk_id = ?').run(chunkId).changes
}

export interface KnnOptions {
  /** Number of neighbours; default 10. */
  k?: number
  /** Only vectors from this model's space. Required: distances across models are meaningless. */
  modelId: string
  /** Restrict to one source (vec0 partition key: only that partition is scanned). */
  sourceId?: string
}

export interface KnnHit {
  id: string
  chunkId: string
  sourceId: string
  /** L2 distance — lower is closer. */
  distance: number
}

/** Nearest neighbours of `embedding` (brute force inside the partition; fine below
 * ~200k chunks, docs/spec/05-ingestion-rag.md §3). Soft-deleted chunks — and the chunks of
 * a soft-deleted source — never appear: triggers drop their vectors as they go. */
export function knnChunks(
  sqlite: Database,
  embedding: ArrayLike<number>,
  options: KnnOptions,
): KnnHit[] {
  const k = options.k ?? 10
  const sourceFilter = options.sourceId !== undefined ? 'AND source_id = @sourceId' : ''

  return sqlite
    .prepare<
      { embedding: Buffer; k: number; modelId: string; sourceId?: string },
      { id: string; chunk_id: string; source_id: string; distance: number }
    >(
      `SELECT id, chunk_id, source_id, distance
         FROM embeddings
        WHERE embedding MATCH @embedding AND k = @k AND model_id = @modelId ${sourceFilter}
        ORDER BY distance`,
    )
    .all({
      embedding: vectorToBlob(embedding),
      k,
      modelId: options.modelId,
      sourceId: options.sourceId,
    })
    .map((row) => ({
      id: row.id,
      chunkId: row.chunk_id,
      sourceId: row.source_id,
      distance: row.distance,
    }))
}
