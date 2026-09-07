import { mkdir, rm } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { type JobContext, uuidv7 } from '@retenia/core'
import { createFsBlobStore } from '../main/blobs/store'
import { confinePath, JobCancelledError } from './confine'
import type { SidecarEnvironment } from './definitions'
import type { IngestParseInput, IngestParseResult } from './ingest-parse'

/**
 * The job side of the audio/video pipeline (sub-phase 6.4).
 *
 * Split out of `./ingest-parse.ts` because it is a different kind of work with the same
 * result: where a document parse reads some bytes and returns, this one has to put two
 * third-party binaries and a speech model on the machine, run them over a scratch directory it
 * owns, and clean up after itself whether it succeeded, failed or was cancelled. Keeping that
 * beside the `readFile`-and-parse path would bury both.
 *
 * The division of labour is deliberate:
 *
 *  - **`packages/ingest`** owns the pipeline and knows nothing about Electron, `userData` or
 *    the job queue. It is handed absolute paths and a signal.
 *  - **This file** owns the *environment*: which binary, which model, which scratch directory,
 *    and what happens to them afterwards.
 *  - **`main/library/service.ts`** owns the database. This job never touches SQLite, exactly
 *    like every other job (`apps/desktop/src/main/jobs/runner.ts`'s `onSettled` hook).
 */

/**
 * Fetching the binaries and the model is a *phase of the job the user already started*, not an
 * error to resolve by hand — the same choice `ingestEmbedSource` makes about ONNX weights. On
 * a first import that means the bar sits in this band for a few minutes while ~200 MB arrives;
 * saying so in the message is the difference between "downloading Whisper (34 %)" and a
 * progress bar that appears to have stalled.
 */
const SETUP_BAND = 0.15

export interface MediaJobEnvironment {
  readableRoots: readonly string[]
  modelsRoot?: string
  sidecars?: SidecarEnvironment
}

export async function runMediaParse(
  environment: MediaJobEnvironment,
  input: IngestParseInput,
  ctx: JobContext,
): Promise<IngestParseResult> {
  const { readableRoots, sidecars } = environment
  const modelsRoot = environment.modelsRoot ?? (readableRoots[0] as string)
  const blobStore = createFsBlobStore(readableRoots[0] as string)

  if (input.kind !== 'audio' && input.kind !== 'video') {
    throw new Error(`runMediaParse was handed a ${input.kind} source`)
  }

  // Loaded here rather than at the top of the module: `definitions.ts` is shared with main,
  // and the sidecar manager reaches for `node:child_process`. Main has no business evaluating
  // a process spawner to read the job registry's metadata.
  const [{ ensureMediaToolchain }, { parseMedia }, { createTesseractOcrProvider }] =
    await Promise.all([
      import('../main/media/toolchain'),
      import('@retenia/ingest/media'),
      import('@retenia/ingest'),
    ])

  // Every source has at least one part; a single recording is a one-part course, which is what
  // keeps audio, video and folders on one code path from here down.
  const parts = input.parts ?? [
    {
      blobSha256: input.blobSha256,
      ext: input.ext,
      mime: input.kind === 'video' ? 'video/mp4' : 'audio/mpeg',
      title: input.title,
      sectionPath: [] as string[],
      ordinal: 0,
    },
  ]

  ctx.progress(0.01, 'preparing the transcriber')
  const tools = await ensureMediaToolchain({
    modelsRoot,
    sidecars,
    signal: ctx.signal as unknown as AbortSignal,
    onProgress: (fraction, message) => ctx.progress(SETUP_BAND * fraction, message),
  })

  if (ctx.signal.aborted) throw new JobCancelledError()

  // A directory per job, not per source: two attempts of the same source must not find each
  // other's half-written WAV, and the cleanup below can then be unconditional.
  const workDir = join(readableRoots[1] ?? readableRoots[0] ?? '.', `media-${ctx.jobId}`)
  await mkdir(workDir, { recursive: true })

  try {
    const resolved = []
    for (const part of parts) {
      resolved.push({
        // Confined even though main is the only enqueuer: a job payload is persisted data, no
        // more trustworthy than whoever wrote it.
        path: await confinePath(
          readableRoots,
          blobStore.path(part.blobSha256, part.ext),
          'ingestParseSource',
        ),
        blobSha256: part.blobSha256,
        mime: part.mime,
        title: part.title,
        sectionPath: part.sectionPath,
        ordinal: part.ordinal,
      })
    }

    const doc = await parseMedia(
      { kind: input.kind, parts: resolved, fallbackTitle: input.title },
      {
        id: uuidv7,
        putAsset: async (bytes, mime, kind) => {
          const put = await blobStore.put(bytes, mime)
          return { id: uuidv7(), blobSha256: put.sha256, mime: put.mime, kind }
        },
      },
      {
        tools,
        workDir,
        signal: ctx.signal,
        // The pipeline reports 0–1 over its own work; the setup band has already been spent.
        progress: (fraction, message) =>
          ctx.progress(SETUP_BAND + (1 - SETUP_BAND) * fraction, message),
        // Local Tesseract by default (`docs/spec/05-ingestion-rag.md` §1). The `vision` role
        // port of sub-phase 7.x drops into this same seam — a cloud describer is a different
        // `OcrProvider`, not a different pipeline. `cacheDir` keeps its downloaded
        // traineddata in the model store instead of the job worker's `cwd`.
        ocr: createTesseractOcrProvider({ cacheDir: join(modelsRoot, 'tesseract') }),
        threads: Math.max(1, Math.min(8, availableParallelism() - 1)),
      },
    )

    ctx.progress(0.98, 'saving the transcript')
    const json = new TextEncoder().encode(JSON.stringify(doc))
    const { sha256: sourceDocBlobSha256 } = await blobStore.put(json, 'application/json')

    ctx.progress(1, 'done')
    return {
      sourceDocBlobSha256,
      title: doc.title,
      language: doc.language,
      blockCount: doc.blocks.length,
      assetCount: doc.assets.length,
      needsOcr: false,
      ocrPages: [],
      warnings: doc.meta.warnings,
      ...(doc.meta.media === undefined ? {} : { media: doc.meta.media }),
    }
  } finally {
    // Unconditional: a cancelled transcription can leave a few hundred megabytes of WAV and
    // PNGs behind, and `userData/work` is not swept by anything else.
    await rm(workDir, { recursive: true, force: true })
  }
}
