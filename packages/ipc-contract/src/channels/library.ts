import { z } from 'zod'
import { defineContract } from '../define'

/**
 * The source library: importing a file or pasted text, watching it parse, and reading back
 * what the parser found (sub-phase 6.1, `docs/spec/05-ingestion-rag.md` §1).
 *
 * `source_units`/`chunks` are not part of this surface yet — sub-phase 6.2's structural
 * chunking populates those; until then the per-source detail view reads the parser's own
 * `SourceDoc` (`library.getSourceDoc`), fetched straight from the blob it was written to.
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

  /** For drag-and-drop: the renderer resolves each dropped `File` to an absolute path via
   *  the preload's `getPathForFile` (not this contract — see `apps/desktop/src/preload`)
   *  and hands the paths here. */
  'library.addSourceFromPaths': {
    input: z.object({ paths: z.array(z.string().min(1)).min(1).max(50) }),
    output: z.object({ sources: z.array(sourceSummarySchema) }),
  },

  'library.addSourceFromText': {
    input: z.object({
      text: z.string().min(1).max(2_000_000),
      title: z.string().min(1).max(300),
    }),
    output: sourceSummarySchema,
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
