import type { JobContext, JobDefinition } from '@retenia/core'
import { confinePath } from './confine'

/**
 * Downloading a local ONNX model into `<userData>/models/`, with a progress bar and a
 * SHA-256 check per file (sub-phase 6.3; `docs/spec/05-ingestion-rag.md` §3).
 *
 * A queue job rather than a fetch on some button's click handler, because it is the only
 * shape that gives all four things this needs: a visible progress bar in the tray, a cancel
 * button, a retry with backoff when the network drops, and resumption after the app is
 * closed mid-download. A 300–570 MB transfer has to survive all of those.
 *
 * It is also what `ingestEmbedSource` calls into before it embeds anything, so "the model is
 * missing" is never an error the user has to resolve by hand — it is a phase of the job they
 * already started, with the same bar.
 */

export interface DownloadModelInput {
  /** A catalog id: `embeddinggemma-300m`, `bge-m3`, `bge-reranker-v2-m3`. */
  modelId: string
  /** Re-hash what is already on disk instead of trusting the receipt. The "repair" action. */
  verify?: boolean
}

export type DownloadModelResult = {
  modelId: string
  /** Files transferred this run; empty when the model was already installed. */
  downloaded: string[]
  bytesDownloaded: number
  /** Total size of the model on disk. */
  bytes: number
}

export function createDownloadModelJob(
  modelsRoot: string,
  readableRoots: readonly string[],
): JobDefinition<DownloadModelInput, DownloadModelResult> {
  return {
    type: 'downloadModel',
    // A transfer this size deserves more than the queue's default three tries: a laptop lid
    // closing mid-download is the common case, and each retry resumes at the next file.
    defaultMaxAttempts: 5,
    parseInput: (payload) => {
      const modelId = payload.modelId
      if (typeof modelId !== 'string' || modelId.length === 0) {
        throw new Error('downloadModel needs a non-empty string "modelId"')
      }
      const verify = payload.verify
      if (verify !== undefined && typeof verify !== 'boolean') {
        throw new Error('downloadModel needs a boolean "verify"')
      }
      return { modelId, ...(verify === undefined ? {} : { verify }) }
    },
    run: (input, ctx) => run(modelsRoot, readableRoots, input, ctx),
  }
}

async function run(
  modelsRoot: string,
  readableRoots: readonly string[],
  input: DownloadModelInput,
  ctx: JobContext,
): Promise<DownloadModelResult> {
  // Loaded here rather than at the top of the module for the reason `ingest-chunk.ts` gives:
  // `definitions.ts` is shared with main, and only the worker downloads.
  const { createModelStore, downloadModel, requireModel } = await import('@retenia/ingest')

  const spec = requireModel(input.modelId)
  // The models root is app-owned and passed in from `getModelsRoot()`, but it still goes
  // through the same confinement every other job's paths do — a job payload is persisted
  // data, no more trustworthy than whoever wrote it.
  const root = await confinePath(readableRoots, modelsRoot, 'downloadModel')
  const store = createModelStore(root)

  if (input.verify === true) {
    ctx.progress(0, `verifying ${spec.id}`)
    const issues = await store.verify(spec, {
      onProgress: (fraction) => ctx.progress(fraction * 0.5, `verifying ${spec.id}`),
      signal: ctx.signal,
    })
    if (issues.length > 0) {
      ctx.log.warn(`${spec.id}: ${issues.length} file(s) did not verify; re-downloading`, {
        files: issues.map((issue) => issue.file),
      })
    }
  }

  const base = input.verify === true ? 0.5 : 0
  const span = 1 - base
  const result = await downloadModel(spec, {
    store,
    signal: ctx.signal as AbortSignal,
    onProgress: ({ fraction, bytesDone, bytesTotal, file }) => {
      ctx.progress(
        base + fraction * span,
        file === ''
          ? spec.id
          : `${file} — ${Math.round(bytesDone / 1e6)}/${Math.round(bytesTotal / 1e6)} MB`,
      )
    },
  })

  ctx.progress(1, 'done')
  return {
    modelId: spec.id,
    downloaded: result.downloaded,
    bytesDownloaded: result.bytesDownloaded,
    bytes: spec.bytes,
  }
}
