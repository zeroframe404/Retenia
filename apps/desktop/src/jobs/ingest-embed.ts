import { readFile } from 'node:fs/promises'
import type { JobContext, JobDefinition } from '@retenia/core'
import { createFsBlobStore } from '../main/blobs/store'
import { confinePath } from './confine'

/**
 * Embedding one source's chunks (sub-phase 6.3; `docs/spec/05-ingestion-rag.md` §3, §4).
 *
 * Same split as `ingest-parse.ts` and `ingest-chunk.ts`, and for the same reason: the job
 * reads a blob, computes, and writes a blob — it never touches SQLite, because main is the
 * database's single writer (`docs/spec/07-architecture.md` §5). `main/library/
 * embedding-service.ts` writes the vectors into `embeddings_i8` once the job settles.
 *
 * What is embedded is `context + text`, not `text` alone: the 50–100 tokens of contextual
 * retrieval written in sub-phase 6.2 exist precisely so that a paragraph which only ever says
 * "this phase" carries the name its chapter gave it into the vector too. When a source has no
 * context (the improved index is off), it is the text by itself.
 *
 * The model is ensured first, inside this job's own progress: a missing model is a phase of
 * the work the user already started, not an error they have to go and resolve.
 */

export interface IngestEmbedInput {
  sourceId: string
  /** The blob `embedding-service.ts` wrote: what to embed, in chunk order. */
  textsBlobSha256: string
  /** Catalog id of the local model, or absent when `ollama` is given instead. */
  modelId?: string
  /** Use an OpenAI-compatible server instead of a bundled model. */
  ollama?: { baseUrl: string; model: string; nativeDims: number }
  /** Execution provider to try first; defaults to `auto`. */
  device?: string
  /** Texts per forward pass; defaults to the provider's own choice. */
  batchSize?: number
}

/** One entry of the texts blob. */
export interface EmbeddableChunk {
  chunkId: string
  /** `context + text`, already assembled by main — the worker does no domain reasoning. */
  text: string
}

export interface EmbedTextsBlob {
  sourceId: string
  chunks: EmbeddableChunk[]
}

/**
 * The vectors blob: int8 rows and, when precise vectors are on, the float ones beside them.
 *
 * Base64 rather than an array of 768 numbers per chunk: a 600-chunk book is 460 KB of int8
 * against ~9 MB of JSON text, and this file is written once and read once.
 */
export interface EmbedVectorsBlob {
  sourceId: string
  /** The space these vectors are in — written onto every row. */
  modelId: string
  dims: number
  chunkIds: string[]
  /** `chunkIds.length × dims` float32 values, little-endian, base64. */
  vectors: string
}

export type IngestEmbedResult = {
  vectorsBlobSha256: string
  modelId: string
  dims: number
  chunkCount: number
  /** The execution provider the session actually ran on, for the perf notes. */
  device: string
  /** Milliseconds spent in the forward passes, for `docs/perf/rag.md`. */
  embedMs: number
}

function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`ingestEmbedSource needs a non-empty string "${key}"`)
  }
  return value
}

export function createIngestEmbedJob(
  modelsRoot: string,
  readableRoots: readonly string[],
): JobDefinition<IngestEmbedInput, IngestEmbedResult> {
  return {
    type: 'ingestEmbedSource',
    parseInput: (payload) => {
      const sourceId = readString(payload, 'sourceId')
      const textsBlobSha256 = payload.textsBlobSha256
      // Hex, not just 64 characters: the value is joined into a filesystem path below, and
      // `confinePath` is the backstop, not the only check.
      if (typeof textsBlobSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(textsBlobSha256)) {
        throw new Error('ingestEmbedSource needs a 64-character hex "textsBlobSha256"')
      }

      const ollamaRaw = payload.ollama
      let ollama: IngestEmbedInput['ollama']
      if (ollamaRaw !== undefined && ollamaRaw !== null) {
        if (typeof ollamaRaw !== 'object') {
          throw new Error('ingestEmbedSource needs an object "ollama"')
        }
        const record = ollamaRaw as Record<string, unknown>
        const nativeDims = record.nativeDims
        if (typeof nativeDims !== 'number' || !Number.isInteger(nativeDims) || nativeDims <= 0) {
          throw new Error('ingestEmbedSource needs a positive integer "ollama.nativeDims"')
        }
        ollama = {
          baseUrl: readString(record, 'baseUrl'),
          model: readString(record, 'model'),
          nativeDims,
        }
      }

      const modelId = payload.modelId
      if (modelId !== undefined && typeof modelId !== 'string') {
        throw new Error('ingestEmbedSource needs a string "modelId"')
      }
      if (modelId === undefined && ollama === undefined) {
        throw new Error('ingestEmbedSource needs either a "modelId" or an "ollama" server')
      }

      const device = payload.device
      if (device !== undefined && typeof device !== 'string') {
        throw new Error('ingestEmbedSource needs a string "device"')
      }
      const batchSize = payload.batchSize
      if (
        batchSize !== undefined &&
        (typeof batchSize !== 'number' || !Number.isInteger(batchSize) || batchSize <= 0)
      ) {
        throw new Error('ingestEmbedSource needs a positive integer "batchSize"')
      }

      return {
        sourceId,
        textsBlobSha256,
        ...(modelId === undefined ? {} : { modelId }),
        ...(ollama === undefined ? {} : { ollama }),
        ...(device === undefined ? {} : { device }),
        ...(batchSize === undefined ? {} : { batchSize }),
      }
    },
    run: (input, ctx) => run(modelsRoot, readableRoots, input, ctx),
  }
}

/** The first quarter of the bar is the model, the rest is the forward passes. */
const MODEL_SHARE = 0.25

async function run(
  modelsRoot: string,
  readableRoots: readonly string[],
  input: IngestEmbedInput,
  ctx: JobContext,
): Promise<IngestEmbedResult> {
  const blobStore = createFsBlobStore(readableRoots[0] as string)

  ctx.progress(0.01, 'reading the chunks')
  const textsPath = await confinePath(
    readableRoots,
    blobStore.path(input.textsBlobSha256, 'json'),
    'ingestEmbedSource',
  )
  const payload = JSON.parse(await readFile(textsPath, 'utf-8')) as EmbedTextsBlob

  const {
    createModelStore,
    createOllamaEmbedding,
    createTransformersEmbedding,
    downloadModel,
    isEmbeddingDevice,
    requireModel,
  } = await import('@retenia/ingest')

  let provider: {
    modelId: string
    dims: number
    embed(texts: readonly string[]): Promise<readonly Float32Array[]>
  }
  let device = 'remote'
  let dispose: (() => Promise<void>) | undefined

  if (input.ollama !== undefined) {
    // Nothing to download and nothing to load: the server owns the model.
    ctx.progress(MODEL_SHARE, `using ${input.ollama.model} on ${input.ollama.baseUrl}`)
    provider = createOllamaEmbedding({
      ...input.ollama,
      signal: ctx.signal,
    })
  } else {
    const spec = requireModel(input.modelId as string, 'embedding')
    const root = await confinePath(readableRoots, modelsRoot, 'ingestEmbedSource')
    const store = createModelStore(root)

    // On demand: the first source a user embeds is what pays for the download, inside the
    // job they already started rather than behind a separate button they have to find.
    await downloadModel(spec, {
      store,
      signal: ctx.signal as AbortSignal,
      onProgress: ({ fraction, file }) => {
        ctx.progress(fraction * MODEL_SHARE * 0.9, file === '' ? spec.id : `downloading ${file}`)
      },
    })

    ctx.progress(MODEL_SHARE * 0.9, `loading ${spec.id}`)
    const local = await createTransformersEmbedding({
      spec,
      modelsRoot: root,
      ...(input.device !== undefined && isEmbeddingDevice(input.device)
        ? { device: input.device }
        : {}),
      ...(input.batchSize === undefined ? {} : { batchSize: input.batchSize }),
      signal: ctx.signal,
      onDevice: (chosen) => ctx.log.info(`${spec.id} is running on ${chosen}`),
      onBatch: (done, total) => {
        ctx.progress(
          MODEL_SHARE + (done / Math.max(1, total)) * (1 - MODEL_SHARE),
          `${done}/${total}`,
        )
      },
    })
    provider = local
    device = local.device
    dispose = () => local.dispose()
  }

  try {
    ctx.progress(MODEL_SHARE, `embedding ${payload.chunks.length} chunks`)
    const startedAt = Date.now()
    const vectors = await provider.embed(payload.chunks.map((chunk) => chunk.text))
    const embedMs = Date.now() - startedAt

    if (vectors.length !== payload.chunks.length) {
      throw new Error(
        `${provider.modelId} returned ${vectors.length} vectors for ${payload.chunks.length} chunks`,
      )
    }

    // One flat buffer rather than an array of arrays: main reads it back with a single
    // `subarray` per chunk, and it keeps the blob a quarter the size of the JSON equivalent.
    const flat = new Float32Array(vectors.length * provider.dims)
    vectors.forEach((vector, index) => {
      flat.set(vector, index * provider.dims)
    })

    ctx.progress(0.97, 'saving the vectors')
    const blob: EmbedVectorsBlob = {
      sourceId: payload.sourceId,
      modelId: provider.modelId,
      dims: provider.dims,
      chunkIds: payload.chunks.map((chunk) => chunk.chunkId),
      vectors: Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength).toString('base64'),
    }
    const { sha256 } = await blobStore.put(
      new TextEncoder().encode(JSON.stringify(blob)),
      'application/json',
    )

    ctx.progress(1, 'done')
    return {
      vectorsBlobSha256: sha256,
      modelId: provider.modelId,
      dims: provider.dims,
      chunkCount: payload.chunks.length,
      device,
      embedMs,
    }
  } finally {
    // Hundreds of megabytes of weights; the pool would recycle the worker eventually, but
    // not before it had taken the next job with the session still resident.
    await dispose?.()
  }
}
