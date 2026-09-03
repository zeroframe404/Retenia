import type { Database, Statement } from 'better-sqlite3'

/**
 * Typed access to the three index structures the raw migrations create over `chunks`:
 * the FTS5 table `chunks_fts` (migration 0001), the exact vector table `embeddings`
 * (`FLOAT[768]`, migration 0001) and its int8 companion `embeddings_i8` (migration 0002).
 *
 * These are the primitives; `hybrid-search.ts` composes them into the retrieval pipeline of
 * `docs/spec/05-ingestion-rag.md` §4 (BM25 ∪ vector → RRF → reranker → top-N).
 */

/** The vector space of `embeddings.embedding`: `float[768]` (EmbeddingGemma-300M's native
 * width; other models are truncated/projected to it by the embedding job). Changing it means
 * a new vec0 table in a new migration and a full reindex. */
export const EMBEDDING_DIMENSIONS = 768

/** The FTS5 tokenizer of `chunks_fts`: `corazon` matches `corazón`, case-insensitive. */
export const FTS_TOKENIZER = 'unicode61 remove_diacritics 2'

/**
 * `bm25()` weights, one per column of `chunks_fts` in declaration order
 * (`chunk_id`, `source_id`, `text`, `heading_path`). The two UNINDEXED columns contribute
 * nothing and take weight 0; a hit in the heading path (`Fisiología > Capítulo 3`) counts
 * half a hit in the body, so a chapter title cannot outrank the paragraph that answers the
 * question. `bm25()` returns a *negative* number and lower is better.
 */
export const FTS_COLUMN_WEIGHTS = [0, 0, 1, 0.5] as const

/** Column indexes of `chunks_fts`, for `snippet()` and `highlight()`. */
const FTS_TEXT_COLUMN = 2
const FTS_HEADING_COLUMN = 3

/**
 * Prepared-statement cache, per connection. The SQL of a filtered query varies with the
 * number of source ids, so statements are keyed by their text; without this, a search loop
 * re-prepares on every call (measurable at 50k chunks — see `hybrid-search.bench.ts`).
 */
const statementCache = new WeakMap<Database, Map<string, Statement>>()

function prepared(sqlite: Database, sql: string): Statement {
  let cache = statementCache.get(sqlite)
  if (cache === undefined) {
    cache = new Map()
    statementCache.set(sqlite, cache)
  }
  const hit = cache.get(sql)
  if (hit !== undefined) return hit
  const statement = sqlite.prepare(sql)
  cache.set(sql, statement)
  return statement
}

/** `AND source_id IN (?, ?, …)`, or nothing when the filter is absent. */
function sourceFilterSql(sourceIds: readonly string[] | undefined): string {
  if (sourceIds === undefined || sourceIds.length === 0) return ''
  return ` AND source_id IN (${sourceIds.map(() => '?').join(', ')})`
}

/** `undefined` (no filter) vs `[]` (an impossible filter) are different questions. */
function isImpossibleFilter(sourceIds: readonly string[] | undefined): boolean {
  return sourceIds !== undefined && sourceIds.length === 0
}

// --- FTS5 query building -------------------------------------------------------------------

interface FtsTerm {
  /** The literal text, before quoting. */
  text: string
  /** Match anything starting with this term (FTS5 `*`). */
  prefix: boolean
}

/**
 * Splits user input into terms: a run inside double quotes is one phrase, everything else
 * splits on whitespace, and a trailing `*` marks a prefix term. An unterminated quote runs
 * to the end of the input rather than being an error — people type `"la sangre` and expect
 * a search, not a parser complaint.
 */
function parseTerms(text: string): FtsTerm[] {
  const terms: FtsTerm[] = []
  let index = 0

  const takePrefixMarker = (): boolean => {
    if (text[index] === '*') {
      index++
      return true
    }
    return false
  }

  while (index < text.length) {
    const char = text[index] as string
    if (/\s/.test(char)) {
      index++
      continue
    }
    if (char === '"') {
      index++
      const start = index
      while (index < text.length && text[index] !== '"') index++
      const phrase = text.slice(start, index)
      if (index < text.length) index++ // closing quote
      const prefix = takePrefixMarker()
      if (phrase.trim().length > 0) terms.push({ text: phrase, prefix })
      continue
    }
    const start = index
    while (index < text.length && !/[\s"*]/.test(text[index] as string)) index++
    const word = text.slice(start, index)
    const prefix = takePrefixMarker()
    if (word.length > 0) terms.push({ text: word, prefix })
  }

  return terms
}

export interface FtsQueryOptions {
  /**
   * Make the last term a prefix term, for type-ahead ("mitoc" finds "mitocondrias").
   * Only the last one: an all-prefix query matches far too much and skews BM25.
   */
  prefix?: boolean
}

/**
 * Turns free text into a safe FTS5 MATCH expression. Every term is emitted as a quoted
 * phrase — with any inner `"` doubled, FTS5's own escape — so user input can never be
 * parsed as index syntax (`OR`, `NOT`, `NEAR`, parentheses and column filters are all just
 * words). Terms are joined by implicit AND. Returns `''` when there is nothing to search.
 */
export function ftsQuery(text: string, options: FtsQueryOptions = {}): string {
  const terms = parseTerms(text)
  if (terms.length === 0) return ''
  const lastIndex = terms.length - 1
  return terms
    .map((term, index) => {
      const prefix = term.prefix || (options.prefix === true && index === lastIndex)
      return `"${term.text.replace(/"/g, '""')}"${prefix ? '*' : ''}`
    })
    .join(' ')
}

// --- Full-text search ----------------------------------------------------------------------

export interface FtsSearchOptions {
  limit?: number
  /** Restrict to these sources. Absent = every source; empty = no source (no results). */
  sourceIds?: readonly string[]
  /** Approximate snippet length in tokens (FTS5 `snippet()`), default 24. */
  snippetTokens?: number
}

export interface FtsHit {
  chunkId: string
  sourceId: string
  /** 1-based position in this result set. */
  rank: number
  /** Raw `bm25()` with `FTS_COLUMN_WEIGHTS` — negative, and lower is better. */
  bm25: number
  /** The matching passage of the text, with `<b>…</b>` around the hits. */
  snippet: string
  /** The whole heading path with `<b>…</b>` around the hits, when it matched. */
  headingHighlight: string
}

interface FtsRow {
  chunk_id: string
  source_id: string
  bm25_score: number
  snippet: string
  heading_highlight: string
}

/** Full-text search over chunk text and heading paths. `query` is raw FTS5 syntax — build
 * it with `ftsQuery()` unless you mean to expose operators. */
export function searchChunksFts(
  sqlite: Database,
  query: string,
  options: FtsSearchOptions = {},
): FtsHit[] {
  if (query.trim().length === 0) return []
  if (isImpossibleFilter(options.sourceIds)) return []
  const limit = options.limit ?? 50
  const snippetTokens = options.snippetTokens ?? 24
  const weights = FTS_COLUMN_WEIGHTS.join(', ')

  const sql = `SELECT chunk_id, source_id,
            bm25(chunks_fts, ${weights}) AS bm25_score,
            snippet(chunks_fts, ${FTS_TEXT_COLUMN}, '<b>', '</b>', '…', ?) AS snippet,
            highlight(chunks_fts, ${FTS_HEADING_COLUMN}, '<b>', '</b>') AS heading_highlight
       FROM chunks_fts
      WHERE chunks_fts MATCH ?${sourceFilterSql(options.sourceIds)}
      ORDER BY bm25_score
      LIMIT ?`

  const rows = prepared(sqlite, sql).all(
    snippetTokens,
    query,
    ...(options.sourceIds ?? []),
    limit,
  ) as FtsRow[]

  return rows.map((row, index) => ({
    chunkId: row.chunk_id,
    sourceId: row.source_id,
    rank: index + 1,
    bm25: row.bm25_score,
    snippet: row.snippet,
    headingHighlight: row.heading_highlight,
  }))
}

// --- Vectors -------------------------------------------------------------------------------

function assertDimensions(vector: ArrayLike<number>): void {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new RangeError(
      `embedding must have ${EMBEDDING_DIMENSIONS} dimensions, got ${vector.length}`,
    )
  }
}

/** Packs a vector into the little-endian `float32` blob sqlite-vec expects. */
export function vectorToBlob(vector: ArrayLike<number>): Buffer {
  assertDimensions(vector)
  const floats = vector instanceof Float32Array ? vector : Float32Array.from(vector)
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength)
}

/**
 * Packs a vector into the int8 blob `embeddings_i8` holds: `round(x · 127)`, clamped.
 *
 * The mapping assumes **unit vectors** — every `EmbeddingProvider` L2-normalizes, so each
 * component is already in [-1, 1] and the full int8 range is used. A component outside that
 * range is clamped rather than rejected: a single odd value must not fail an ingestion run,
 * and clamping only costs precision on that component.
 *
 * Quantization is done here rather than with sqlite-vec's `vec_quantize_int8(v, 'unit')`
 * because the *same* function has to be applied to the stored vectors and to the query
 * vector — one function in one language cannot drift, and `'unit'` uses an asymmetric
 * affine mapping (`trunc((x + 1) · 127.5) - 128`) that is slightly less accurate around 0.
 */
export function quantizeToInt8(vector: ArrayLike<number>): Buffer {
  assertDimensions(vector)
  const out = Buffer.allocUnsafe(EMBEDDING_DIMENSIONS)
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    const scaled = Math.round((vector[i] as number) * 127)
    out.writeInt8(Math.max(-128, Math.min(127, Number.isFinite(scaled) ? scaled : 0)), i)
  }
  return out
}

export interface EmbeddingRow {
  /** UUIDv7. Shared by the float row and its int8 mirror. */
  id: string
  sourceId: string
  chunkId: string
  /** The model that produced the vector — never mix spaces in one query. */
  modelId: string
  embedding: ArrayLike<number>
}

const INSERT_FLOAT_SQL =
  'INSERT INTO embeddings (id, source_id, chunk_id, model_id, embedding) VALUES (?, ?, ?, ?, ?)'
/** `vec_int8()` tags the blob: sqlite-vec would otherwise read 768 bytes as 192 float32s. */
const INSERT_INT8_SQL =
  'INSERT INTO embeddings_i8 (id, source_id, chunk_id, model_id, embedding) VALUES (?, ?, ?, ?, vec_int8(?))'

/** Inserts one vector into both the exact and the quantized index. Use inside a transaction
 * for bulk loads — the two writes must not be able to come apart. */
export function insertEmbedding(sqlite: Database, row: EmbeddingRow): void {
  const args = [row.id, row.sourceId, row.chunkId, row.modelId] as const
  prepared(sqlite, INSERT_FLOAT_SQL).run(...args, vectorToBlob(row.embedding))
  prepared(sqlite, INSERT_INT8_SQL).run(...args, quantizeToInt8(row.embedding))
}

/** Removes the vectors of one chunk (all models, both indexes), returning how many exact
 * vectors went. The vec0 indexes are derived data: unlike domain tables they are deleted and
 * rebuilt, never soft-deleted. */
export function deleteEmbeddingsForChunk(sqlite: Database, chunkId: string): number {
  const removed = prepared(sqlite, 'DELETE FROM embeddings WHERE chunk_id = ?').run(chunkId).changes
  prepared(sqlite, 'DELETE FROM embeddings_i8 WHERE chunk_id = ?').run(chunkId)
  return removed
}

/**
 * Which index a KNN query scans.
 *
 * `int8` (the default) scans `embeddings_i8` and then rescores its candidates against the
 * exact float vectors, so the distances and the order it returns are exact and only the
 * *candidate set* is approximate. `float32` scans `embeddings` directly — no approximation
 * at all, at 4× the bytes read. See the tradeoff note on `knnChunks`.
 */
export type VectorPrecision = 'int8' | 'float32'

export interface KnnOptions {
  /** Number of neighbours; default 10. */
  k?: number
  /** Only vectors from this model's space. Required: distances across models are meaningless. */
  modelId: string
  /** Restrict to these sources (vec0 partition key: only those partitions are scanned).
   *  Absent = every source; empty = no source (no results). */
  sourceIds?: readonly string[]
  /** Defaults to `int8`. */
  precision?: VectorPrecision
  /** How many int8 candidates to rescore exactly; default `max(2 · k, 64)`, never below `k`.
   *  Higher trades latency for recall — the benchmark's curve is in the note on
   *  `knnChunks`. Ignored when `precision` is `float32`. */
  rescoreCandidates?: number
}

export interface KnnHit {
  id: string
  chunkId: string
  sourceId: string
  /** Exact L2 distance to the stored float vector — lower is closer, in both precisions. */
  distance: number
}

interface KnnRow {
  id: string
  chunk_id: string
  source_id: string
  distance: number
}

function knnFloat32(
  sqlite: Database,
  embedding: ArrayLike<number>,
  k: number,
  options: KnnOptions,
): KnnHit[] {
  const sql = `SELECT id, chunk_id, source_id, distance
       FROM embeddings
      WHERE embedding MATCH ? AND k = ? AND model_id = ?${sourceFilterSql(options.sourceIds)}
      ORDER BY distance`
  const rows = prepared(sqlite, sql).all(
    vectorToBlob(embedding),
    k,
    options.modelId,
    ...(options.sourceIds ?? []),
  ) as KnnRow[]
  return rows.map((row) => ({
    id: row.id,
    chunkId: row.chunk_id,
    sourceId: row.source_id,
    distance: row.distance,
  }))
}

const RESCORE_SQL = 'SELECT vec_distance_l2(embedding, ?) AS distance FROM embeddings WHERE id = ?'

function knnInt8(
  sqlite: Database,
  embedding: ArrayLike<number>,
  k: number,
  options: KnnOptions,
): KnnHit[] {
  const candidateCount = Math.max(options.rescoreCandidates ?? Math.max(k * 2, 64), k)
  const sql = `SELECT id, chunk_id, source_id, distance
       FROM embeddings_i8
      WHERE embedding MATCH vec_int8(?) AND k = ? AND model_id = ?${sourceFilterSql(options.sourceIds)}
      ORDER BY distance`
  const candidates = prepared(sqlite, sql).all(
    quantizeToInt8(embedding),
    candidateCount,
    options.modelId,
    ...(options.sourceIds ?? []),
  ) as KnnRow[]

  // Exact rescoring: one primary-key lookup per candidate (~0.08 ms each at 50k rows), which
  // is what turns an approximate candidate set into an exact top-k over that set.
  const exact = prepared(sqlite, RESCORE_SQL)
  const blob = vectorToBlob(embedding)
  const rescored: KnnHit[] = []
  for (const candidate of candidates) {
    const row = exact.get(blob, candidate.id) as { distance: number } | undefined
    // A candidate with no exact row means the two indexes disagree — the embedding job is
    // mid-write. Dropping it is the safe reading: `embeddings` is the source of truth.
    if (row === undefined) continue
    rescored.push({
      id: candidate.id,
      chunkId: candidate.chunk_id,
      sourceId: candidate.source_id,
      distance: row.distance,
    })
  }

  rescored.sort((left, right) =>
    left.distance === right.distance
      ? left.id.localeCompare(right.id)
      : left.distance - right.distance,
  )
  return rescored.slice(0, k)
}

/**
 * Nearest neighbours of `embedding`. Brute force inside the partition — sqlite-vec has no
 * ANN index — which is fine below ~200k chunks (`docs/spec/05-ingestion-rag.md` §3);
 * past that the vector index moves to LanceDB behind the `VectorIndex` port.
 *
 * **The int8 tradeoff, measured.** `pnpm --filter @retenia/db bench` over 50k × 768 vectors
 * (numbers in that run's output; the shape is what matters, not the absolute milliseconds):
 *
 * | top-50 query           | latency | recall vs exact | index |
 * |------------------------|---------|-----------------|-------|
 * | int8, no rescoring     |  ~96 ms |          ~90 %  | 37 MB |
 * | int8 + 2× rescoring    | ~108 ms |           100 % | 37 MB |
 * | int8 + 4× rescoring    | ~130 ms |           100 % | 37 MB |
 * | exact float32 scan     | ~114 ms |           100 % | 146 MB|
 *
 * So quantization does not buy much raw speed — sqlite-vec is brute force either way — and
 * what it costs is *ranking*: an int8 scan alone misses about a tenth of the true top-50.
 * Rescoring its candidates against the exact float vectors buys that back completely, and
 * the distances reported are always the exact ones. `2 ·  k` is where the curve crosses: full
 * recall, slightly faster than scanning float32, over an index a quarter of the size — which
 * is the part that really matters once the database is on disk and the page cache is cold.
 * Deeper rescoring only costs latency; there is nothing left to recover.
 *
 * Soft-deleted chunks — and the chunks of a soft-deleted source — never appear: the triggers
 * of migrations 0001 and 0002 drop their vectors as they go.
 */
export function knnChunks(
  sqlite: Database,
  embedding: ArrayLike<number>,
  options: KnnOptions,
): KnnHit[] {
  const k = options.k ?? 10
  if (k <= 0) return []
  if (isImpossibleFilter(options.sourceIds)) return []
  return options.precision === 'float32'
    ? knnFloat32(sqlite, embedding, k, options)
    : knnInt8(sqlite, embedding, k, options)
}
