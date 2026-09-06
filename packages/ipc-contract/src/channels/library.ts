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
  kind: z.enum(['image', 'thumbnail']),
  locator: locatorSchema.optional(),
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
  }),
})
export type SourceDocDto = z.infer<typeof sourceDocSchema>

/** Per dropped file: well above a book-sized PDF or a high-resolution scan, and small enough
 *  that the copy IPC's structured clone makes of it is no concern on a desktop. Files chosen
 *  through the native dialog have no cap — main reads those itself. */
export const MAX_IMPORT_FILE_BYTES = 256 * 1024 * 1024

/** One `chunks` row as the Library shows it: enough to render the list and open the source at
 *  the right page, without shipping the audit columns. */
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

  'library.addSourceFromText': {
    input: z.object({
      text: z.string().min(1).max(2_000_000),
      title: z.string().min(1).max(300),
    }),
    output: sourceSummarySchema,
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
})
