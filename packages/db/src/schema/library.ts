import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import {
  atLeast,
  auditColumns,
  idColumn,
  inRange,
  inTextList,
  type JsonObject,
  jsonColumn,
  jsonObject,
  standardChecks,
  timestampColumn,
} from './_common'

/**
 * Source library: what the user loads, how it is split for citation and retrieval, and
 * what they mark on it (docs/spec/05-ingestion-rag.md §1, §4; docs/spec/07-architecture.md §5).
 *
 * The two search structures over `chunks` — the FTS5 table `chunks_fts` and the sqlite-vec
 * table `embeddings` — are virtual tables that Drizzle cannot model; they are created by
 * the raw-SQL migrations `0001_fts5_vec0_seed.sql` and `0008_chunk_identity_and_context.sql`
 * and queried through `src/search.ts`.
 */

/** What a source is: decides the extractor (docs/spec/05-ingestion-rag.md §1). */
export const SOURCE_KINDS = [
  'pdf',
  'docx',
  'epub',
  'pptx',
  'markdown',
  'text',
  'image',
  'audio',
  'video',
  'youtube',
  'web',
] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

export const SOURCE_STATUSES = ['pending', 'processing', 'ready', 'failed'] as const
export type SourceStatus = (typeof SOURCE_STATUSES)[number]

/**
 * Where a source stands in the *vector* index, which is a different question from whether it
 * parsed (`sources.status`): a source can be perfectly readable and searchable by BM25 while
 * its embeddings are missing, queued behind a model download, or stale because the user
 * switched embedding models (`docs/spec/05-ingestion-rag.md` §3, "never mix spaces; reindex
 * as a job").
 *
 * - `pending` — chunked, not embedded yet. Also where a source lands when the model changes.
 * - `running` — an `ingestEmbedSource` job holds it.
 * - `ready` — every live chunk has a vector in `sources.embedding_model_id`'s space.
 * - `failed` — the last run failed; `embedding_error` says why, and retrieval degrades to
 *   full text rather than to nothing.
 */
export const EMBEDDING_STATUSES = ['pending', 'running', 'ready', 'failed'] as const
export type EmbeddingStatus = (typeof EMBEDDING_STATUSES)[number]

/** Page (PDF/EPUB), slide (PPTX), section (DOCX/Markdown/web), keyframe or transcript
 * segment (audio/video) — the citable, navigable unit a chunk points back to. */
export const SOURCE_UNIT_KINDS = ['page', 'slide', 'section', 'keyframe', 'segment'] as const
export type SourceUnitKind = (typeof SOURCE_UNIT_KINDS)[number]

export const ANNOTATION_KINDS = ['highlight', 'note', 'region', 'clip'] as const
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number]

/**
 * Content-addressed files kept *outside* the database at `blobs/<sha256[0:2]>/<sha256>.<ext>`
 * (docs/spec/07-architecture.md §5): free dedupe, integrity, trivial future sync. This
 * table is the index over that directory; `media://blob/<sha256>` serves them.
 */
export const blobs = sqliteTable(
  'blobs',
  {
    id: idColumn(),
    /** Lower-case hex SHA-256 of the file's bytes — the file's identity and its path. */
    sha256: text('sha256').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    /** Extension used on disk (`pdf`, `png`, `ogg`…), without the dot. */
    ext: text('ext'),
    /** The name the file had when it was imported, for display only. */
    originalName: text('original_name'),
    /** Dimensions, duration, page count… whatever the extractor learned. */
    meta: jsonColumn('meta').$type<JsonObject>(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('blobs_sha256').on(t.sha256),
    check('blobs_sha256_hex', sql`length(${t.sha256}) = 64 AND ${t.sha256} = lower(${t.sha256})`),
    check('blobs_bytes_nonnegative', atLeast(t.bytes, 0)),
    check('blobs_meta_json', jsonObject(t.meta)),
    ...standardChecks('blobs', t),
  ],
)

/**
 * One imported document, recording, page or link (docs/spec/07-architecture.md §5).
 *
 * Soft-deleting a source cascades (by trigger, see `migrations/0001_fts5_vec0_seed.sql`)
 * to its `source_units` and `chunks`, which takes them out of `chunks_fts` and
 * `embeddings`; un-deleting it restores them. Knowledge items and annotations made from
 * the source keep their `source_id` as provenance and are not touched.
 */
export const sources = sqliteTable(
  'sources',
  {
    id: idColumn(),
    kind: text('kind', { enum: SOURCE_KINDS }).notNull(),
    title: text('title').notNull(),
    /** Where it came from: a `file://` path, an `https://` URL, a YouTube URL. */
    originUri: text('origin_uri'),
    /** The stored file, when there is one (web/YouTube sources may have none). */
    blobSha256: text('blob_sha256').references(() => blobs.sha256),
    status: text('status', { enum: SOURCE_STATUSES }).notNull().default('pending'),
    /** BCP-47 tag of the content's language, once detected. */
    language: text('language'),
    /** Extractor output that is not worth a column: page count, author, duration, OCR flags… */
    meta: jsonColumn('meta').$type<JsonObject>(),
    /** Last ingestion error, for the "Processing" panel. */
    error: text('error'),
    ingestedAt: timestampColumn('ingested_at'),
    /** Where this source stands in the vector index; see `EMBEDDING_STATUSES`. */
    embeddingStatus: text('embedding_status', { enum: EMBEDDING_STATUSES })
      .notNull()
      .default('pending'),
    /**
     * The space its vectors are in — an `EmbeddingProvider.modelId`, e.g.
     * `embeddinggemma-300m@768`. NULL until the first successful run.
     *
     * This column *is* the reindex trigger: the sweep at startup asks for every ready source
     * whose `embedding_model_id` is not the active provider's, and re-embeds those. Comparing
     * against the model rather than tracking a "stale" flag means switching models and
     * switching back cannot lose track of what is already correct.
     */
    embeddingModelId: text('embedding_model_id'),
    /** Why the last embedding run failed, for the source card. */
    embeddingError: text('embedding_error'),
    /**
     * Where the reader left off: `{ page }` for a PDF, `{ cfi }` for an EPUB. Written by
     * `library.recordProgress` on every page turn/section change (sub-phase 6.6) and read by
     * Home's "Continuar donde estaba" and by the reader itself to resume a source. `null`
     * until the source has been opened in a reader at least once.
     */
    lastLocator: jsonColumn('last_locator').$type<JsonObject>(),
    /** When the reader was last open on this source — Home's "recently opened" order. `null`
     *  alongside `lastLocator`. */
    lastOpenedAt: timestampColumn('last_opened_at'),
    ...auditColumns(),
  },
  (t) => [
    index('sources_status').on(t.status),
    index('sources_blob').on(t.blobSha256),
    /** "Which sources need embedding, and which are in another space?" — one index scan. */
    index('sources_embedding').on(t.embeddingStatus, t.embeddingModelId),
    /** Home's "Continuar donde estaba": the most recently opened sources, oldest last. */
    index('sources_last_opened').on(t.lastOpenedAt),
    check('sources_kind', inTextList(t.kind, SOURCE_KINDS)),
    check('sources_status', inTextList(t.status, SOURCE_STATUSES)),
    check('sources_embedding_status', inTextList(t.embeddingStatus, EMBEDDING_STATUSES)),
    check('sources_meta_json', jsonObject(t.meta)),
    check('sources_last_locator_json', jsonObject(t.lastLocator)),
    ...standardChecks('sources', t),
  ],
)

/**
 * The navigable units of a source: pages, slides, sections, keyframes, transcript
 * segments. Citations and highlights anchor here (`[S3 p.112]`, "jump to 12:30").
 */
export const sourceUnits = sqliteTable(
  'source_units',
  {
    id: idColumn(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id),
    kind: text('kind', { enum: SOURCE_UNIT_KINDS }).notNull(),
    /** Position inside the source (page number, slide number, segment index). */
    ordinal: integer('ordinal').notNull(),
    /** Human label: `p. 12`, `Slide 4`, `12:30`. */
    label: text('label'),
    /** Media time range in milliseconds for keyframes and segments. */
    tStart: integer('t_start'),
    tEnd: integer('t_end'),
    /** Extracted text of the unit (page text, transcript segment, keyframe OCR). */
    text: text('text'),
    /** A rendered page or keyframe image, when one was captured. */
    blobSha256: text('blob_sha256').references(() => blobs.sha256),
    meta: jsonColumn('meta').$type<JsonObject>(),
    ...auditColumns(),
  },
  (t) => [
    index('source_units_source_ordinal').on(t.sourceId, t.ordinal),
    check('source_units_kind', inTextList(t.kind, SOURCE_UNIT_KINDS)),
    check('source_units_ordinal_nonnegative', atLeast(t.ordinal, 0)),
    check(
      'source_units_time_range',
      sql`${t.tStart} IS NULL OR ${t.tEnd} IS NULL OR ${t.tEnd} >= ${t.tStart}`,
    ),
    check('source_units_meta_json', jsonObject(t.meta)),
    ...standardChecks('source_units', t),
  ],
)

/**
 * Retrieval and citation unit (docs/spec/05-ingestion-rag.md §4): a section-bounded span of
 * 300–500 tokens with its heading path. Mirrored into `chunks_fts` by triggers; embedded
 * into `embeddings` by the embedding job.
 */
export const chunks = sqliteTable(
  'chunks',
  {
    id: idColumn(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id),
    /** The unit the chunk starts in, for "open the source at the exact page/timestamp". */
    unitId: text('unit_id').references(() => sourceUnits.id),
    /** Reading order inside the source. */
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    /** Character offsets into the normalized source text. */
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    tokenCount: integer('token_count').notNull(),
    /** SHA-256 of `text`: dedupe across re-ingestion and the idempotency key of embedding jobs. */
    hash: text('hash').notNull(),
    /** `Book > Ch. 3 > 3.2` — indexed by FTS alongside the text. */
    headingPath: text('heading_path'),
    /** The 50–100 tokens of "contextual retrieval" context, when the improved index is on. */
    context: text('context'),
    /**
     * `sha256(source_id, block_ids, text)`, the chunker's own deterministic key
     * (`packages/ingest/src/chunking/chunk-key.ts`). The row's `id` is a UUIDv7 like every
     * other row's; this is the *natural* key beside it, and it is what makes re-chunking
     * idempotent: an unchanged document produces the same keys, so the store can leave those
     * rows — and the embeddings hanging off them — exactly where they are.
     *
     * No hex CHECK on it, unlike `hash`: SQLite can only add one by rebuilding the table,
     * and a rebuild drops every trigger on it — the FTS5 and vec0 sync of migrations 0001
     * and 0002 included. A nullable column only the chunker writes is not worth that.
     */
    chunkKey: text('chunk_key'),
    /**
     * `<rules version>:<tokenizer id>` (`1:chars4`). The reindex trigger: when the chunking
     * rules or the tokenizer change, every chunk written under the old value was cut at
     * different boundaries and the source has to be chunked again. NULL is a chunk written
     * before this column existed, which is equally stale.
     */
    chunkingVersion: text('chunking_version'),
    /**
     * Table of contents, copyright page, index, bibliography… Flagged, never dropped: the
     * chunk is still citable and still worth retrieving, but stage 4 of the generation
     * pipeline excludes it so the outline mirrors the book's argument rather than its index
     * (`docs/spec/04-path-generation.md` §14, pitfall 6).
     */
    isFrontmatter: integer('is_frontmatter', { mode: 'boolean' }).notNull().default(false),
    /** Page/timestamp/anchor plus the block ids the chunk covers (`chunk_id → block_ids`). */
    locator: jsonColumn('locator').$type<JsonObject>(),
    ...auditColumns(),
  },
  (t) => [
    index('chunks_source_ordinal').on(t.sourceId, t.ordinal),
    index('chunks_hash').on(t.hash),
    index('chunks_unit').on(t.unitId),
    /** One row per key per source, so a re-chunk can upsert instead of matching by text. */
    uniqueIndex('chunks_source_key').on(t.sourceId, t.chunkKey),
    /** "Which sources are stale?" is one scan of this index, not of every chunk's text. */
    index('chunks_chunking_version').on(t.chunkingVersion),
    check('chunks_char_range', sql`${t.charStart} >= 0 AND ${t.charEnd} >= ${t.charStart}`),
    check('chunks_token_count_nonnegative', atLeast(t.tokenCount, 0)),
    check('chunks_hash_hex', sql`length(${t.hash}) = 64`),
    check('chunks_locator_json', jsonObject(t.locator)),
    ...standardChecks('chunks', t),
  ],
)

/**
 * What the user marks on a source: a highlight (rects on a PDF page, a CFI range in an
 * EPUB), a note, an image region, or a media clip (`t_start`–`t_end`). Highlights become
 * knowledge items ("highlight → card"); the item points back via
 * `knowledge_items.annotation_id`.
 */
export const annotations = sqliteTable(
  'annotations',
  {
    id: idColumn(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id),
    unitId: text('unit_id').references(() => sourceUnits.id),
    kind: text('kind', { enum: ANNOTATION_KINDS }).notNull(),
    /** Where exactly: `{ rects, page }`, `{ cfi }`, `{ x, y, w, h }` or `{ tStart, tEnd }`. */
    anchor: jsonColumn('anchor').$type<JsonObject>().notNull(),
    /** The selected/quoted text, when the anchor covers text. */
    quote: text('quote'),
    /** The user's own comment. */
    note: text('note'),
    color: text('color'),
    /** Media time range in milliseconds for clips. */
    tStart: real('t_start'),
    tEnd: real('t_end'),
    ...auditColumns(),
  },
  (t) => [
    index('annotations_source').on(t.sourceId),
    index('annotations_unit').on(t.unitId),
    check('annotations_kind', inTextList(t.kind, ANNOTATION_KINDS)),
    check('annotations_anchor_json', jsonObject(t.anchor)),
    check(
      'annotations_time_range',
      sql`${t.tStart} IS NULL OR ${t.tEnd} IS NULL OR ${t.tEnd} >= ${t.tStart}`,
    ),
    check('annotations_t_start_nonnegative', inRange(t.tStart, 0, Number.MAX_SAFE_INTEGER)),
    ...standardChecks('annotations', t),
  ],
)
