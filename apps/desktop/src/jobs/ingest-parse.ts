import { readFile } from 'node:fs/promises'
import {
  type JobContext,
  type JobDefinition,
  SOURCE_KINDS,
  type SourceKind,
  uuidv7,
} from '@retenia/core'
import type { SourceDoc } from '@retenia/ingest'
import { createFsBlobStore } from '../main/blobs/store'
import { confinePath } from './confine'

/**
 * Parsing an imported source into a `SourceDoc` (sub-phase 6.1;
 * `docs/spec/05-ingestion-rag.md` §1). Mirrors `fsrs-optimize.ts`'s split: this job measures
 * and produces — it never touches SQLite — and `apps/desktop/src/main/library/service.ts`
 * applies the result to the `sources` row once the job settles
 * (`apps/desktop/src/main/jobs/runner.ts`'s `onSettled` hook).
 *
 * The worker writes blobs directly (the parsed `SourceDoc` JSON, any rendered/extracted
 * assets): `BlobStore` is pure `node:fs`/`node:crypto`, so a second instance here, pointed at
 * the same root main's already uses, needs no coordination — writes are content-addressed.
 */

export interface IngestParseInput {
  sourceId: string
  blobSha256: string
  ext: string | null
  kind: SourceKind
  /** The source's title at enqueue time (the imported file's name, typically) — the
   *  fallback a parser uses when the format itself carries no better one. */
  title: string
}

/**
 * The job's result, as it is stored in `jobs.result`: small and JSON-safe. The full
 * `SourceDoc` — which can be a whole book's worth of text — lives in the blob
 * `sourceDocBlobSha256` names, per `jobSummarySchema`'s own rule ("anything large belongs in
 * a blob with its hash recorded here").
 */
export type IngestParseResult = {
  sourceDocBlobSha256: string
  title: string
  language: string | null
  blockCount: number
  assetCount: number
  needsOcr: boolean
  ocrPages: number[]
  warnings: string[]
}

function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === 'string' && (SOURCE_KINDS as readonly string[]).includes(value)
}

export function createIngestParseJob(
  readableRoots: readonly string[],
): JobDefinition<IngestParseInput, IngestParseResult> {
  return {
    type: 'ingestParseSource',
    parseInput: (payload) => {
      const sourceId = payload.sourceId
      const blobSha256 = payload.blobSha256
      const ext = payload.ext
      const kind = payload.kind
      const title = payload.title
      if (typeof sourceId !== 'string' || sourceId.length === 0) {
        throw new Error('ingestParseSource needs a non-empty string "sourceId"')
      }
      if (typeof blobSha256 !== 'string' || blobSha256.length !== 64) {
        throw new Error('ingestParseSource needs a 64-character hex "blobSha256"')
      }
      if (ext !== null && typeof ext !== 'string') {
        throw new Error('ingestParseSource needs "ext" as a string or null')
      }
      if (!isSourceKind(kind)) {
        throw new Error(
          `ingestParseSource needs a known source "kind", got ${JSON.stringify(kind)}`,
        )
      }
      if (typeof title !== 'string' || title.length === 0) {
        throw new Error('ingestParseSource needs a non-empty string "title"')
      }
      return { sourceId, blobSha256, ext, kind, title }
    },
    run: (input, ctx) => run(readableRoots, input, ctx),
  }
}

async function run(
  readableRoots: readonly string[],
  input: IngestParseInput,
  ctx: JobContext,
): Promise<IngestParseResult> {
  const blobStore = createFsBlobStore(readableRoots[0] as string)

  ctx.progress(0.05, 'reading the source file')
  const path = await confinePath(
    readableRoots,
    blobStore.path(input.blobSha256, input.ext),
    'ingestParseSource',
  )
  const bytes = new Uint8Array(await readFile(path))

  // Loaded here, not at the top of the module: this file is shared by main and the job
  // worker (`definitions.ts`), and only the worker ever runs a parse. The parsers drag in
  // pdfjs, tesseract and pdfium, which main has no reason to evaluate at startup.
  const { createTesseractOcrProvider, parseDocument } = await import('@retenia/ingest')

  ctx.progress(0.15, `parsing ${input.kind}`)
  const doc = await parseDocument(
    input.kind,
    { bytes, fallbackTitle: input.title },
    {
      id: uuidv7,
      putAsset: async (assetBytes, mime, kind) => {
        const put = await blobStore.put(assetBytes, mime)
        return { id: uuidv7(), blobSha256: put.sha256, mime: put.mime, kind }
      },
    },
    // Local Tesseract by default (`docs/spec/05-ingestion-rag.md` §1); a cloud `OcrProvider`
    // (Gemini Flash-Lite, Mistral OCR) is a phase-7 addition behind the same port, not a
    // change to this job.
    createTesseractOcrProvider(),
  )
  if (ctx.signal.aborted) throw new Error('ingestParseSource was cancelled')

  ctx.progress(0.9, 'saving the parsed document')
  const sourceDocJson = new TextEncoder().encode(JSON.stringify(doc satisfies SourceDoc))
  const { sha256: sourceDocBlobSha256 } = await blobStore.put(sourceDocJson, 'application/json')

  ctx.progress(1, 'done')
  return {
    sourceDocBlobSha256,
    title: doc.title,
    language: doc.language,
    blockCount: doc.blocks.length,
    assetCount: doc.assets.length,
    needsOcr: doc.meta.needsOcr ?? false,
    ocrPages: doc.meta.ocrPages ?? [],
    warnings: doc.meta.warnings,
  }
}
