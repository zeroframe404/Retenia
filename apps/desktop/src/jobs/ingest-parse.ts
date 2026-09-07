import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type JobContext,
  type JobDefinition,
  type JsonObject,
  SOURCE_KINDS,
  type SourceKind,
  uuidv7,
} from '@retenia/core'
import type { SourceDoc } from '@retenia/ingest'
import { createFsBlobStore } from '../main/blobs/store'
import { confinePath } from './confine'
import type { SidecarEnvironment } from './definitions'
import { runMediaParse } from './ingest-media'

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

/** One file of a media source. A single recording has exactly one; a course folder has one
 *  per lecture, in reading order. */
export interface IngestParsePart {
  blobSha256: string
  ext: string | null
  mime: string
  /** The lesson's title, derived from its file name at import time. */
  title: string
  /** Folder titles, outermost first — the course's own outline. */
  sectionPath: string[]
  ordinal: number
}

export interface IngestParseInput {
  sourceId: string
  blobSha256: string
  ext: string | null
  kind: SourceKind
  /** The source's title at enqueue time (the imported file's name, typically) — the
   *  fallback a parser uses when the format itself carries no better one. */
  title: string
  /**
   * The media files this source is made of (sub-phase 6.4), when it is an `audio` or `video`
   * one. Absent for every other kind, and for a single recording it is just the one blob the
   * fields above already name — the field exists because a course folder is *one source with
   * many files*, and `sources.blob_sha256` can only hold the first of them.
   */
  parts?: IngestParsePart[]
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
  /**
   * What the media pipeline learned (sub-phase 6.4), for `sources.meta.media`. Absent for
   * every other kind. Durations and timeline offsets are only knowable after ffprobe has run,
   * so the completed part list comes back from the job rather than being written at import.
   */
  media?: {
    durationSec: number | null
    parts: {
      blobSha256: string
      mime: string
      title: string
      startSec: number
      durationSec: number | null
      ordinal: number
    }[]
    transcript: {
      engine: string
      modelId: string
      variant: string
      language: string | null
      vad: boolean
      vttBlobSha256: string | null
    } | null
    keyframes: {
      count: number
      strategy: 'scene' | 'interval'
      duplicatesDropped: number
      overBudgetDropped: number
    } | null
    vision: { provider: string; framesDescribed: number } | null
  }
  /** Where the content came from and when it was fetched (sub-phase 6.5), for `web`/`youtube`
   *  sources. Absent for every other kind. Aliased to `SourceDoc`'s own field rather than
   *  redeclared, so this can't silently drift out of sync with it the way it once did — this
   *  type used to omit `videoId`/`playlistId`/`playlistIndex` even though `SourceDoc.meta.origin`
   *  and `sourceMetaSchema` both already carried them (`reviewer` finding). */
  origin?: NonNullable<SourceDoc['meta']['origin']>
}

function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === 'string' && (SOURCE_KINDS as readonly string[]).includes(value)
}

function parseParts(payload: JsonObject): IngestParsePart[] | undefined {
  const parts = payload.parts
  if (parts === undefined || parts === null) return undefined
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('ingestParseSource needs "parts" to be a non-empty array when present')
  }
  return parts.map((raw, index) => {
    const part = raw as Record<string, unknown>
    const blobSha256 = part.blobSha256
    const mime = part.mime
    const title = part.title
    const ext = part.ext ?? null
    const sectionPath = part.sectionPath ?? []
    const ordinal = part.ordinal ?? index
    if (typeof blobSha256 !== 'string' || blobSha256.length !== 64) {
      throw new Error(`ingestParseSource part ${index} needs a 64-character hex "blobSha256"`)
    }
    if (typeof mime !== 'string' || mime.length === 0) {
      throw new Error(`ingestParseSource part ${index} needs a non-empty string "mime"`)
    }
    if (typeof title !== 'string' || title.length === 0) {
      throw new Error(`ingestParseSource part ${index} needs a non-empty string "title"`)
    }
    if (ext !== null && typeof ext !== 'string') {
      throw new Error(`ingestParseSource part ${index} needs "ext" as a string or null`)
    }
    if (!Array.isArray(sectionPath) || sectionPath.some((entry) => typeof entry !== 'string')) {
      throw new Error(`ingestParseSource part ${index} needs "sectionPath" as an array of strings`)
    }
    if (typeof ordinal !== 'number' || !Number.isInteger(ordinal) || ordinal < 0) {
      throw new Error(`ingestParseSource part ${index} needs a non-negative integer "ordinal"`)
    }
    return { blobSha256, ext, mime, title, sectionPath: sectionPath as string[], ordinal }
  })
}

export function createIngestParseJob(
  readableRoots: readonly string[],
  modelsRoot?: string,
  sidecars?: SidecarEnvironment,
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
      const parts = parseParts(payload)
      return { sourceId, blobSha256, ext, kind, title, ...(parts === undefined ? {} : { parts }) }
    },
    // A transcription is minutes of work that a flaky download or a transient lock can
    // interrupt, so it gets the same retry budget as the model download rather than the
    // default three.
    defaultMaxAttempts: 5,
    run: (input, ctx) =>
      input.kind === 'audio' || input.kind === 'video'
        ? runMediaParse({ readableRoots, modelsRoot, sidecars }, input, ctx)
        : run(readableRoots, modelsRoot, input, ctx),
  }
}

async function run(
  readableRoots: readonly string[],
  modelsRoot: string | undefined,
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
    // change to this job. `cacheDir` keeps its downloaded traineddata in the model store
    // instead of the job worker's `cwd`; `modelsRoot` is only absent in a test double, where
    // there is no stable directory to cache into anyway.
    createTesseractOcrProvider(
      modelsRoot === undefined ? {} : { cacheDir: join(modelsRoot, 'tesseract') },
    ),
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
    ...(doc.meta.origin === undefined ? {} : { origin: doc.meta.origin }),
  }
}
