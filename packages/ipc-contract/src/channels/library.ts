import { z } from 'zod'
import { defineContract } from '../define'

/**
 * The source library: importing a file or pasted text, watching it parse, and reading back
 * what the parser found (sub-phase 6.1, `docs/spec/05-ingestion-rag.md` §1).
 *
 * `library.getSourceDoc` reads the parser's own output straight from the blob it was written
 * to; `library.listChunks` reads the `chunks` rows sub-phase 6.2's structural chunking
 * produced from it, which is what retrieval and citations actually use.
 */

/**
 * Mirrors `SOURCE_KINDS`/`SOURCE_STATUSES` in `packages/db/src/schema/library.ts` and
 * `packages/core/src/entities/enums.ts`. Redeclared rather than imported: this package is a
 * leaf by architectural rule (`tooling/scripts/check-deps.mjs` pins `ipc-contract: []`); its
 * own test asserts the two lists still agree.
 */
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
export const sourceKindSchema = z.enum(SOURCE_KINDS)
export type SourceKind = z.infer<typeof sourceKindSchema>

export const SOURCE_STATUSES = ['pending', 'processing', 'ready', 'failed'] as const
export const sourceStatusSchema = z.enum(SOURCE_STATUSES)
export type SourceStatus = z.infer<typeof sourceStatusSchema>

/** Where the source stands in the *vector* index — a different question from whether it
 *  parsed (sub-phase 6.3, `docs/spec/05-ingestion-rag.md` §3). Mirrors `EMBEDDING_STATUSES`
 *  in `packages/core/src/entities/enums.ts`; its own test asserts the two lists agree. */
/** Mirrors `SOURCE_UNIT_KINDS` in `packages/core/src/entities/enums.ts`; its own test asserts
 *  the two lists still agree. */
export const SOURCE_UNIT_KINDS = ['page', 'slide', 'section', 'keyframe', 'segment'] as const
export const sourceUnitKindSchema = z.enum(SOURCE_UNIT_KINDS)
export type SourceUnitKind = z.infer<typeof sourceUnitKindSchema>

export const EMBEDDING_STATUSES = ['pending', 'running', 'ready', 'failed'] as const
export const embeddingStatusSchema = z.enum(EMBEDDING_STATUSES)
export type EmbeddingStatus = z.infer<typeof embeddingStatusSchema>

/** One file of a media source, positioned on the source's virtual timeline (sub-phase 6.4).
 *  A single recording has one part; a course folder has one per lecture. */
export const mediaPartSchema = z.object({
  blobSha256: z.string(),
  mime: z.string(),
  title: z.string(),
  startSec: z.number(),
  durationSec: z.number().nullable(),
  ordinal: z.int(),
})
export type MediaPartDto = z.infer<typeof mediaPartSchema>

/**
 * What the media pipeline learned about an `audio`/`video` source.
 *
 * Carried on both `sourceMetaSchema` and `sourceDocSchema.meta`, because the player needs it
 * from the cheap `library.getSource` call rather than from the whole `SourceDoc` — a course's
 * document is tens of thousands of blocks, and the player only wants to know which file to
 * load and where it starts.
 */
export const mediaMetaSchema = z.object({
  durationSec: z.number().nullable(),
  parts: z.array(mediaPartSchema),
  transcript: z
    .object({
      engine: z.string(),
      modelId: z.string(),
      variant: z.string(),
      language: z.string().nullable(),
      vad: z.boolean(),
      vttBlobSha256: z.string().nullable(),
    })
    .nullable(),
  keyframes: z
    .object({
      count: z.int(),
      strategy: z.enum(['scene', 'interval']),
      duplicatesDropped: z.int(),
      overBudgetDropped: z.int(),
    })
    .nullable(),
  vision: z.object({ provider: z.string(), framesDescribed: z.int() }).nullable(),
})
export type MediaMetaDto = z.infer<typeof mediaMetaSchema>

/** What `library/service.ts`'s `onJobSettled` writes into `sources.meta` once a parse
 *  succeeds — not the full `SourceDoc`, just enough for a source card to summarize it. */
export const sourceMetaSchema = z
  .object({
    sourceDocBlobSha256: z.string(),
    blockCount: z.number(),
    assetCount: z.number(),
    needsOcr: z.boolean(),
    ocrPages: z.array(z.int()),
    warnings: z.array(z.string()),
    /** Written by sub-phase 6.2's chunk job once it settles; absent until then. */
    chunkCount: z.number().optional(),
    unitCount: z.number().optional(),
    frontmatterChunkCount: z.number().optional(),
    chunkTokenCount: z.number().optional(),
    chunkingVersion: z.string().optional(),
    /** Sub-phase 6.4, for `audio`/`video` sources. */
    media: mediaMetaSchema.optional(),
    /** Sub-phase 6.5, for `web`/`youtube` sources. */
    origin: z
      .object({
        url: z.string(),
        fetchedAt: z.string(),
        author: z.string().nullable().optional(),
        /** `youtube` sources only. */
        videoId: z.string().optional(),
        /** `youtube` sources only, and only when imported from a playlist URL. */
        playlistId: z.string().optional(),
        playlistIndex: z.number().optional(),
      })
      .optional(),
  })
  .nullable()

export const sourceSummarySchema = z.object({
  id: z.uuid(),
  kind: sourceKindSchema,
  title: z.string(),
  status: sourceStatusSchema,
  language: z.string().nullable(),
  error: z.string().nullable(),
  meta: sourceMetaSchema,
  /** The source's own file, for `media://blob/<sha256>.<ext>` — what the PDF/EPUB reader
   *  (sub-phase 6.6) loads. `null` until the source has ingested at least once. */
  blobSha256: z.string().nullable(),
  embeddingStatus: embeddingStatusSchema,
  /** The space the source's vectors are in, e.g. `embeddinggemma-300m@768`. */
  embeddingModelId: z.string().nullable(),
  embeddingError: z.string().nullable(),
  createdAt: z.iso.datetime(),
  ingestedAt: z.iso.datetime().nullable(),
})
export type SourceSummary = z.infer<typeof sourceSummarySchema>

/** A block/section locator — page, bbox, an EPUB/anchor path, or a media offset, whichever
 *  the parser that produced it could give. Mirrors `packages/ingest`'s `Locator`. */
const locatorSchema = z.object({
  page: z.number().optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  anchor: z.string().optional(),
  timeSec: z.number().optional(),
})

const blockSchema = z.object({
  id: z.string(),
  type: z.enum(['heading', 'paragraph', 'list', 'table', 'code', 'figure', 'equation', 'caption']),
  text: z.string(),
  html: z.string().optional(),
  locator: locatorSchema,
  hash: z.string(),
})

export interface SectionDto {
  id: string
  title: string
  level: number
  blocks: string[]
  children: SectionDto[]
}

/** Recursive, so `z.lazy` — a section's `children` are more sections. */
const sectionSchema: z.ZodType<SectionDto> = z.lazy(() =>
  z.object({
    id: z.string(),
    title: z.string(),
    level: z.number(),
    blocks: z.array(z.string()),
    children: z.array(sectionSchema),
  }),
)

const assetSchema = z.object({
  id: z.string(),
  blobSha256: z.string(),
  mime: z.string(),
  /** `keyframe` and `caption` are sub-phase 6.4's; mirrors `packages/ingest`'s `AssetKind`. */
  kind: z.enum(['image', 'thumbnail', 'keyframe', 'caption']),
  locator: locatorSchema.optional(),
  /** A keyframe's OCR or vision description. */
  text: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
})

/**
 * The parser's own output (`packages/ingest`'s `SourceDoc`), as it crosses the bridge.
 *
 * Read straight from the blob `sources.meta.sourceDocBlobSha256` names — for a large source
 * this can be a whole book's worth of blocks in one response; fine at the scale this
 * sub-phase's fixtures target, and flagged in the implementation plan as a follow-up once
 * real multi-hundred-page sources are common (pagination, or a narrower "one section" query).
 */
export const sourceDocSchema = z.object({
  id: z.string(),
  kind: sourceKindSchema,
  title: z.string(),
  language: z.string().nullable(),
  sections: z.array(sectionSchema),
  blocks: z.array(blockSchema),
  assets: z.array(assetSchema),
  meta: z.object({
    pageCount: z.number().optional(),
    needsOcr: z.boolean().optional(),
    ocrPages: z.array(z.int()).optional(),
    ocrConfidence: z.number().optional(),
    warnings: z.array(z.string()),
    frontmatter: z.record(z.string(), z.unknown()).optional(),
    media: mediaMetaSchema.optional(),
    /** Sub-phase 6.5, for `web`/`youtube` sources. */
    origin: z
      .object({
        url: z.string(),
        fetchedAt: z.string(),
        author: z.string().nullable().optional(),
        /** `youtube` sources only. */
        videoId: z.string().optional(),
        /** `youtube` sources only, and only when imported from a playlist URL. */
        playlistId: z.string().optional(),
        playlistIndex: z.number().optional(),
      })
      .optional(),
  }),
})
export type SourceDocDto = z.infer<typeof sourceDocSchema>

/** Per dropped file: well above a book-sized PDF or a high-resolution scan, and small enough
 *  that the copy IPC's structured clone makes of it is no concern on a desktop. Files chosen
 *  through the native dialog have no cap — main reads those itself. */
export const MAX_IMPORT_FILE_BYTES = 256 * 1024 * 1024

/** One `chunks` row as the Library shows it: enough to render the list and open the source at
 *  the right page, without shipping the audit columns. */
/** One `source_units` row as the player needs it: a transcript window to jump to, or a
 *  keyframe to draw a marker for. */
export const sourceUnitSummarySchema = z.object({
  id: z.uuid(),
  kind: sourceUnitKindSchema,
  ordinal: z.int(),
  /** `p. 12`, `Slide 4`, `12:30`. */
  label: z.string().nullable(),
  /** Media offsets in milliseconds, on the source's global timeline. */
  tStartMs: z.int().nullable(),
  tEndMs: z.int().nullable(),
  /** A transcript window's text, or a keyframe's OCR. */
  text: z.string().nullable(),
  /** The keyframe image, for `media://blob/<sha>.png`. */
  blobSha256: z.string().nullable(),
})
export type SourceUnitSummary = z.infer<typeof sourceUnitSummarySchema>

export const chunkSummarySchema = z.object({
  id: z.uuid(),
  ordinal: z.int(),
  /** An excerpt when `truncated`: a chunk that is one huge table has no size ceiling, and this
   *  list clamps what it renders anyway. */
  text: z.string(),
  truncated: z.boolean(),
  tokenCount: z.int(),
  headingPath: z.string().nullable(),
  /** The 50–100 tokens of contextual retrieval, when the improved index has run. */
  context: z.string().nullable(),
  isFrontmatter: z.boolean(),
  /** `p. 12`, `Slide 4`, `12:30` — what a citation shows. */
  label: z.string().nullable(),
  page: z.int().nullable(),
  /** Media offsets in milliseconds, for transcript windows. */
  tStartMs: z.int().nullable(),
  tEndMs: z.int().nullable(),
  /** `chunk_id → block_ids`: the source blocks this chunk covers. */
  blockIds: z.array(z.string()),
})
export type ChunkSummary = z.infer<typeof chunkSummarySchema>

/** What the "índice mejorado" toggle quotes before it is switched on
 *  (`docs/spec/05-ingestion-rag.md` §4.2). */
export const contextualizationEstimateSchema = z.object({
  /** Chunks that still have no context — a resumed run quotes only what is left. */
  chunkCount: z.int(),
  inputTokens: z.int(),
  cachedInputTokens: z.int(),
  outputTokens: z.int(),
  usd: z.number(),
})
export type ContextualizationEstimateDto = z.infer<typeof contextualizationEstimateSchema>

/**
 * One hit from the hybrid retrieval of `docs/spec/05-ingestion-rag.md` §4
 * (top-50 BM25 ∪ top-50 vector → RRF → reranker → top-N), with everything the Library's
 * search results need to render a citation and to act on it.
 */
export const searchHitSchema = z.object({
  chunkId: z.uuid(),
  sourceId: z.uuid(),
  sourceTitle: z.string(),
  sourceKind: sourceKindSchema,
  /** Comparable within one result set only. Higher is better in every mode. */
  score: z.number(),
  /** The fusion score before reranking; equal to `score` when no reranker ran. */
  fusionScore: z.number(),
  /**
   * The matching passage with `<b>…</b>` around the hits — FTS5's own `snippet()`. Present
   * only for a hit the full-text branch found, which is why a purely semantic hit shows the
   * head of the chunk instead.
   *
   * Renderers must **not** put this in `innerHTML`: it is chunk text, i.e. content of a file
   * the user imported, and the only markup in it that is ours is the `<b>` pair. The
   * renderer parses those out and builds real elements (`renderSnippet`).
   */
  snippet: z.string(),
  /** True when `snippet` carries `<b>` markers, i.e. the full-text branch matched. */
  highlighted: z.boolean(),
  /** `Libro > Capítulo 3 > 3.2`. */
  headingPath: z.string().nullable(),
  /** `p. 12`, `Slide 4`, `12:30` — what "abrir en la fuente" jumps to. */
  label: z.string().nullable(),
  page: z.int().nullable(),
  tStartMs: z.int().nullable(),
  /** The source blocks this chunk covers, for an exact citation. */
  blockIds: z.array(z.string()),
  /** Which branches found it, for the "why is this here" affordance and for debugging a
   *  disappointing result set. */
  matchedFts: z.boolean(),
  matchedVector: z.boolean(),
})
export type SearchHit = z.infer<typeof searchHitSchema>

export const SEARCH_MODES = ['hybrid', 'fts', 'vector'] as const
export const searchModeSchema = z.enum(SEARCH_MODES)
export type SearchMode = z.infer<typeof searchModeSchema>

/**
 * What the user marks on a source (sub-phase 6.6, `packages/db/src/schema/library.ts`'s
 * `annotations` table): a highlight, a note, an image region or a media clip. Mirrors
 * `ANNOTATION_KINDS` in `packages/core`'s entities and the database `CHECK`; its own test
 * asserts the two lists agree.
 */
export const ANNOTATION_KINDS = ['highlight', 'note', 'region', 'clip'] as const
export const annotationKindSchema = z.enum(ANNOTATION_KINDS)
export type AnnotationKind = z.infer<typeof annotationKindSchema>

/** Rects are fractions (0–1) of the rendered page's width/height, so a highlight anchor is
 *  resolution-independent — the same anchor draws correctly at any zoom level. */
const pdfHighlightAnchorSchema = z.object({
  page: z.int().min(1),
  rects: z.array(z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })),
})
/** An EPUB CFI range (`epubcfi(...)`), resolved back to a DOM `Range` by
 *  `CFI.toRange` (`packages/readers/src/epub/vendor/foliate-js/epubcfi.js`). */
const epubHighlightAnchorSchema = z.object({ cfi: z.string().min(1) })
/** An image occlusion region, in the same 0–1 fractional space as `pdfHighlightAnchorSchema`. */
const regionAnchorSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})
/** A media clip's range, in seconds. Kept alongside `annotations.t_start`/`t_end` (the
 *  queryable columns); the anchor is what a renderer reads back. */
const clipAnchorSchema = z.object({ tStart: z.number().min(0), tEnd: z.number().min(0) })

export const annotationAnchorSchema = z.union([
  pdfHighlightAnchorSchema,
  epubHighlightAnchorSchema,
  regionAnchorSchema,
  clipAnchorSchema,
])
export type AnnotationAnchor = z.infer<typeof annotationAnchorSchema>

export const annotationSchema = z.object({
  id: z.uuid(),
  sourceId: z.uuid(),
  unitId: z.uuid().nullable(),
  kind: annotationKindSchema,
  anchor: annotationAnchorSchema,
  /** The selected/quoted text, when the anchor covers text. */
  quote: z.string().nullable(),
  note: z.string().nullable(),
  color: z.string().nullable(),
  tStart: z.number().nullable(),
  tEnd: z.number().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type AnnotationDto = z.infer<typeof annotationSchema>

/** Where the reader left off: `{ page }` for a PDF, `{ cfi }` for an EPUB. Written by
 *  `library.recordProgress` on every page turn/section change and read back by
 *  `library.listRecentlyOpened` (Home's "Continuar donde estaba") and by the reader itself. */
export const readingLocatorSchema = z.union([
  z.object({ page: z.int().min(1) }),
  z.object({ cfi: z.string().min(1) }),
])
export type ReadingLocator = z.infer<typeof readingLocatorSchema>

export const recentSourceSchema = z.object({
  id: z.uuid(),
  kind: sourceKindSchema,
  title: z.string(),
  locator: readingLocatorSchema,
  lastOpenedAt: z.iso.datetime(),
})
export type RecentSource = z.infer<typeof recentSourceSchema>

export const libraryChannels = defineContract({
  'library.listSources': {
    input: z.object({
      statuses: z.array(sourceStatusSchema).min(1).max(SOURCE_STATUSES.length).optional(),
      limit: z.int().min(1).max(500).optional(),
    }),
    output: z.object({ sources: z.array(sourceSummarySchema) }),
  },

  'library.getSource': {
    input: z.object({ id: z.uuid() }),
    output: z.object({ source: sourceSummarySchema.nullable() }),
  },

  /** `doc` is `null` before the source has parsed successfully at least once. */
  'library.getSourceDoc': {
    input: z.object({ id: z.uuid() }),
    output: z.object({ doc: sourceDocSchema.nullable() }),
  },

  /** Opens a native, multi-select "Open File" dialog filtered to what the Library can
   *  import; resolves an empty list if the user cancels. */
  'library.addSourceFromDialog': {
    input: z.void(),
    output: z.object({ sources: z.array(sourceSummarySchema) }),
  },

  /** For drag-and-drop. The renderer already holds each dropped `File`, so it sends the
   *  bytes themselves and main never opens a path the renderer named — the invariant
   *  `jobs.enqueue` states ("main picks the file … so the renderer never names a path for
   *  the main process to open"), kept here too. IPC's structured clone carries a
   *  `Uint8Array` as is, and the name is all main needs to detect the kind. */
  'library.addSourceFromFiles': {
    input: z.object({
      files: z
        .array(
          z.object({
            name: z.string().min(1).max(300),
            bytes: z
              .instanceof(Uint8Array)
              .refine((bytes) => bytes.byteLength > 0, 'a dropped file cannot be empty')
              .refine(
                (bytes) => bytes.byteLength <= MAX_IMPORT_FILE_BYTES,
                `a dropped file is at most ${MAX_IMPORT_FILE_BYTES} bytes`,
              ),
          }),
        )
        .min(1)
        .max(50),
    }),
    output: z.object({ sources: z.array(sourceSummarySchema) }),
  },

  /**
   * A course folder as one source (sub-phase 6.4): opens a native directory picker, walks it
   * in main, and imports every audio or video file under it as an ordered part of a single
   * source whose section tree is the folder tree.
   *
   * `void` input is load-bearing, exactly as it is for `addSourceFromDialog`: main opens its
   * own dialog, so the renderer never names a directory for the main process to enumerate.
   * `source` is `null` when the user cancels.
   */
  'library.addCourseFromFolder': {
    input: z.void(),
    output: z.object({
      source: sourceSummarySchema.nullable(),
      fileCount: z.int(),
      /** Entries the walk deliberately did not follow — symlinks, unreadable directories. */
      skipped: z.array(z.string()),
      /** True when the folder held more than the walk's cap, so the import is partial. */
      truncated: z.boolean(),
    }),
  },

  /**
   * The source's citable units — transcript windows and keyframes (sub-phases 6.2 and 6.4).
   *
   * The player reads this rather than `library.getSourceDoc`: a course's parsed document is
   * tens of thousands of blocks in one structured clone, and all the player needs is where the
   * segments and the slides are.
   */
  'library.listUnits': {
    input: z.object({
      id: z.uuid(),
      kinds: z.array(sourceUnitKindSchema).min(1).max(SOURCE_UNIT_KINDS.length).optional(),
      limit: z.int().min(1).max(5_000).optional(),
    }),
    output: z.object({ units: z.array(sourceUnitSummarySchema) }),
  },

  'library.addSourceFromText': {
    input: z.object({
      text: z.string().min(1).max(2_000_000),
      title: z.string().min(1).max(300),
    }),
    output: sourceSummarySchema,
  },

  /**
   * A pasted URL (sub-phase 6.5, `docs/spec/05-ingestion-rag.md` §1's "Web" and "YouTube"
   * rows): main fetches the page (or the video's oEmbed metadata and transcript), stores the
   * result and queues its parse. The output is always an array — a page or a single video
   * import returns one source, a YouTube playlist URL returns one per video ("one source per
   * video in a collection") — so the renderer does not need a second shape for that case.
   *
   * `protocol` restricted to http(s), the same restriction `app.deepLink`'s own `import`
   * variant already applies to `src` (`main/deep-links/parse.ts`'s `isAllowedImportSrc`):
   * `net.fetch` — what `web-fetch.ts` calls this URL with — also serves `file://`, and this
   * channel is reachable from the renderer, not only from the pre-validated deep-link path.
   */
  'library.addSourceFromUrl': {
    input: z.object({ url: z.url({ protocol: /^https?$/ }).max(2_000) }),
    output: z.object({
      sources: z.array(sourceSummarySchema),
      /** True only for a YouTube playlist whose public feed hit its own entry limit — its
       *  older videos were left out of `sources`, so the renderer warns rather than leaving the
       *  user to notice a partial import on their own. Always `false` for a single page/video. */
      truncated: z.boolean(),
    }),
  },

  /**
   * The source's chunks in reading order (sub-phase 6.2). Paged: a 300-page book is a few
   * hundred chunks and the detail view shows a window of them.
   */
  'library.listChunks': {
    input: z.object({
      id: z.uuid(),
      limit: z.int().min(1).max(500).optional(),
      offset: z.int().min(0).optional(),
      /** Leave out the table of contents, the copyright page and the bibliography. */
      excludeFrontmatter: z.boolean().optional(),
    }),
    output: z.object({ chunks: z.array(chunkSummarySchema), total: z.int() }),
  },

  /**
   * What contextualizing this source would cost. Read-only and provider-free: it is
   * arithmetic over the chunks and a price table, so it answers before any API key exists.
   */
  'library.estimateContextualization': {
    input: z.object({ id: z.uuid() }),
    output: contextualizationEstimateSchema,
  },

  /** Re-queues a `failed` source's parse with a clean slate. */
  'library.retrySource': {
    input: z.object({ id: z.uuid() }),
    output: sourceSummarySchema,
  },

  /** Soft-deletes the source; its blob is left for a later GC pass (sub-phase 3.5's
   *  `BlobRepository.collectGarbage`), not this channel's concern. */
  'library.deleteSource': {
    input: z.object({ id: z.uuid() }),
    output: z.void(),
  },

  /**
   * Hybrid retrieval over the library (sub-phase 6.3).
   *
   * The renderer never sees a vector: main embeds the query through the warm model host and
   * runs the fusion, because the embedding provider lives behind `safeStorage`-held settings
   * and a native ONNX session, neither of which belongs in a sandboxed renderer.
   *
   * `degraded` says the vector branch could not run — no model configured, or the host could
   * not answer — and the results are full-text only. The UI shows that rather than pretending
   * the answer is the whole answer.
   */
  'library.search': {
    input: z.object({
      query: z.string().min(1).max(1000),
      mode: searchModeSchema.optional(),
      k: z.int().min(1).max(50).optional(),
      /** Restrict to these sources — the filter panel's source facet. */
      sourceIds: z.array(z.uuid()).max(200).optional(),
      /** Restrict to these source kinds — the "type" facet. */
      kinds: z.array(sourceKindSchema).min(1).max(SOURCE_KINDS.length).optional(),
      /** Treat the last word as a prefix, for type-ahead. */
      prefix: z.boolean().optional(),
    }),
    output: z.object({
      hits: z.array(searchHitSchema),
      /** The space the vector branch queried, or `null` when it did not run. */
      modelId: z.string().nullable(),
      degraded: z.boolean(),
      /** Round-trip time main measured, so the UI can show it and `docs/perf/rag.md` has a
       *  number that comes from the real path rather than from a bench harness. */
      tookMs: z.number(),
    }),
  },

  /** Queues one source for embedding, dropping whatever space it was in. The "reindex this
   *  source" action on a source card. */
  'library.embedSource': {
    input: z.object({ id: z.uuid() }),
    output: z.void(),
  },

  /**
   * "Crear tarjeta desde este fragmento": a new knowledge item and its first card, made from
   * one chunk and pointing back at it.
   *
   * The chunk's text is the *back*; the front is the user's own question, because a card
   * whose front is a passage and whose back is the same passage tests nothing
   * (`docs/spec/01-decisions.md` §7: everything ends in active recall). The item keeps
   * `source_id` and the chunk's locator, so the card can always be traced to the page it
   * came from.
   */
  'library.createCardFromChunk': {
    input: z.object({
      chunkId: z.uuid(),
      /** The question. Defaults to the chunk's heading path when the user gives none. */
      front: z.string().min(1).max(2000).optional(),
      /** Overrides the chunk text as the answer, for a user who trimmed it. */
      back: z.string().min(1).max(20000).optional(),
    }),
    output: z.object({ itemId: z.uuid(), cardId: z.uuid() }),
  },

  /**
   * "Crear tarjeta desde este fragmento", for a time range selected in the player
   * (sub-phase 6.4).
   *
   * Separate from `createCardFromChunk` because a chunk is a 60–90 s window the chunker chose
   * and a clip is a range the learner dragged; the two almost never coincide. Same provenance
   * either way — the card can always be traced back to the moment it came from.
   */
  'library.createCardFromClip': {
    input: z.object({
      sourceId: z.uuid(),
      startSec: z.number().min(0),
      endSec: z.number().min(0),
      /** The question. Defaults to the source's title and the timestamp. */
      front: z.string().min(1).max(2000).optional(),
      /** The transcript covering the range. */
      back: z.string().min(1).max(20000).optional(),
    }),
    output: z.object({ itemId: z.uuid(), cardId: z.uuid() }),
  },

  /** What retrieval is configured with, for the search screen's status line and for the
   *  settings screen once sub-phase 7.5 builds it. */
  'library.retrievalStatus': {
    input: z.void(),
    output: z.object({
      /** The active space, or `null` when nothing usable is configured. */
      modelId: z.string().nullable(),
      /** Sources not yet embedded in that space — what the sweep would queue. */
      pendingSources: z.int(),
      rerankerEnabled: z.boolean(),
    }),
  },

  // --- annotations and reading progress (sub-phase 6.6) ---

  /** A source's highlights/notes/regions/clips, in the order they were made — what the reader
   *  restores on open and what the "highlights" panel next to it lists. */
  'library.listAnnotations': {
    input: z.object({ sourceId: z.uuid() }),
    output: z.object({ annotations: z.array(annotationSchema) }),
  },

  /** The selection toolbar's "Resaltar": persists a highlight (or a note/region/clip) so it
   *  survives a restart and can become a card later. */
  'library.createAnnotation': {
    input: z.object({
      sourceId: z.uuid(),
      unitId: z.uuid().optional(),
      kind: annotationKindSchema,
      anchor: annotationAnchorSchema,
      /** The selected/quoted text, when the anchor covers text. */
      quote: z.string().max(20000).optional(),
      note: z.string().max(20000).optional(),
      color: z.string().max(32).optional(),
    }),
    output: z.object({ annotation: annotationSchema }),
  },

  /** Editing a highlight's note or color. The anchor itself never changes — moving it is
   *  deleting and re-creating, which is what a mis-drawn highlight actually needs. */
  'library.updateAnnotation': {
    input: z.object({
      id: z.uuid(),
      note: z.string().max(20000).nullable().optional(),
      color: z.string().max(32).nullable().optional(),
    }),
    output: z.object({ annotation: annotationSchema }),
  },

  /** Soft-deletes the annotation. A card already made from it (`knowledgeItems.annotationId`)
   *  is untouched — provenance, not a live join. */
  'library.deleteAnnotation': {
    input: z.object({ id: z.uuid() }),
    output: z.void(),
  },

  /**
   * The selection toolbar's "Crear tarjeta": a new knowledge item and its first card, made
   * from a highlight and pointing back at it via `annotationId` — the same shape
   * `createCardFromChunk`/`createCardFromClip` use, so "ver en la fuente" works identically
   * whichever way the card was made.
   */
  'library.createCardFromAnnotation': {
    input: z.object({
      annotationId: z.uuid(),
      /** The question. Defaults to the source's title and the citation. */
      front: z.string().min(1).max(2000).optional(),
      /** Overrides the highlight's quote as the answer, for a user who trimmed it. */
      back: z.string().min(1).max(20000).optional(),
    }),
    output: z.object({ itemId: z.uuid(), cardId: z.uuid() }),
  },

  /** Written on every page turn/section change so the reader (and Home's "Continuar donde
   *  estaba") can resume exactly where the user left off. */
  'library.recordProgress': {
    input: z.object({ sourceId: z.uuid(), locator: readingLocatorSchema }),
    output: z.void(),
  },

  /** The most recently opened sources, most recent first — Home's "Continuar donde estaba". */
  'library.listRecentlyOpened': {
    input: z.object({ limit: z.int().min(1).max(50).optional() }),
    output: z.object({ sources: z.array(recentSourceSchema) }),
  },
})
