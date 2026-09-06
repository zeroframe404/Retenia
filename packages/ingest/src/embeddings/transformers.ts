import type { EmbeddingProvider } from '@retenia/core'
import type { ModelSpec } from '../models/catalog'
import {
  type DeviceEnvironment,
  type EmbeddingDevice,
  nodeDeviceEnvironment,
  resolveDevices,
} from './device'
import { assertIndexable, reduceToIndexWidth } from './reduce'

/**
 * The local `EmbeddingProvider`: a catalog model, ONNX, through
 * `@huggingface/transformers` 4 (`docs/spec/05-ingestion-rag.md` §3).
 *
 * Two rules shape everything here.
 *
 * **Nothing reaches the network.** `env.allowRemoteModels = false` and
 * `env.localModelPath = <models root>`, so the library can only ever load files that
 * `../models/download.ts` already put on disk and hashed against the checked-in manifest.
 * A missing file is a clear "the model is not installed" instead of a silent download of
 * unverified weights into a cache directory nobody audits.
 *
 * **It runs in a `utilityProcess`, never in main.** `onnxruntime-node` is a native addon
 * that pins a whole thread pool and hundreds of megabytes of weights; main is the app's
 * single database writer and its UI's event loop. That is why the import below is dynamic:
 * this module is reachable from main's bundle graph through `@retenia/ingest`'s barrel, and
 * only the process that actually embeds should pay for onnxruntime.
 */

/** The bits of `@huggingface/transformers` this module uses. Structural, so a test can pass
 *  a fake without pulling in onnxruntime. */
export interface TransformersModule {
  env: { allowRemoteModels: boolean; localModelPath: string; allowLocalModels?: boolean }
  pipeline(
    task: 'feature-extraction',
    model: string,
    options: Record<string, unknown>,
  ): Promise<FeatureExtractionPipeline>
}

export interface PipelineTensor {
  /** `[batch, dims]` after pooling. */
  dims: readonly number[]
  data: Float32Array | Float64Array
}

export interface FeatureExtractionPipeline {
  (texts: string[], options: Record<string, unknown>): Promise<PipelineTensor>
  dispose?(): Promise<void>
}

export interface TransformersEmbeddingOptions {
  spec: ModelSpec
  /** `<userData>/models`, the root `../models/store.ts` lays models out under. */
  modelsRoot: string
  /** Defaults to `auto`; see `resolveDevices`. */
  device?: EmbeddingDevice
  /** Texts per forward pass. Defaults to `defaultBatchSize(device)`. */
  batchSize?: number
  /** Overrides how the library is loaded — the seam tests use. */
  loadModule?: () => Promise<TransformersModule>
  /** Overrides what `auto` considers available. */
  environment?: DeviceEnvironment
  /** Called once the session is built, with the device that actually took it. */
  onDevice?: (device: string) => void
  /** Reports batches as they finish, for a job's progress bar. */
  onBatch?: (done: number, total: number) => void
  signal?: { readonly aborted: boolean }
}

export interface LocalEmbeddingProvider extends EmbeddingProvider {
  /** The execution provider the session was actually built with. */
  readonly device: string
  readonly batchSize: number
  /** Frees the ONNX session. The worker calls it before it exits or unloads on idle. */
  dispose(): Promise<void>
}

/**
 * Texts per forward pass.
 *
 * Measured for EmbeddingGemma-300M on 4 CPU cores (`docs/perf/rag.md`): 331 ms per chunk at
 * batch 1, 164 at 4, 130 at 8, 114 at 16, 102 at 32. The curve is still improving at 32 —
 * 16 is not where it flattens, it is where the last 11 % stops being worth doubling the
 * activation memory again. That ceiling is not abstract: the job pool recycles a worker whose
 * RSS passes 512 MB (`main/jobs/pool.ts`), and the weights alone are ~310 MB.
 *
 * A GPU inverts the trade — it is throughput-bound and idle at small batches — so it gets a
 * much wider one. That number is **(unverified)**: no GPU run exists yet.
 */
export function defaultBatchSize(device: string): number {
  return device === 'cpu' ? 16 : 64
}

/** The one place the heavy dependency is named. */
async function loadTransformers(): Promise<TransformersModule> {
  return (await import('@huggingface/transformers')) as unknown as TransformersModule
}

/**
 * Builds the session, trying each candidate device in turn and falling back to the next when
 * ONNX Runtime refuses it — which is the only way to find out whether an execution provider
 * really works on this machine.
 */
async function buildPipeline(
  transformers: TransformersModule,
  spec: ModelSpec,
  devices: readonly string[],
): Promise<{ extractor: FeatureExtractionPipeline; device: string }> {
  const failures: string[] = []
  for (const device of devices) {
    try {
      const extractor = await transformers.pipeline('feature-extraction', spec.repo, {
        dtype: spec.dtype,
        device,
        local_files_only: true,
      })
      return { extractor, device }
    } catch (error) {
      failures.push(`${device}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(
    `Could not load ${spec.id} on any execution provider (${failures.join('; ') || 'none tried'})`,
  )
}

/**
 * One pooled vector per text, sliced out of the `[batch, dims]` tensor the pipeline returns.
 *
 * `normalize: false` on purpose: the pipeline would normalize at the model's *native* width,
 * and for a model that is then reduced (truncated or projected) the result would no longer be
 * unit-length. `reduceToIndexWidth` normalizes once, at the width the index actually stores.
 */
function splitBatch(tensor: PipelineTensor, count: number, spec: ModelSpec): Float32Array[] {
  const dims = tensor.dims[tensor.dims.length - 1]
  if (dims !== spec.nativeDims) {
    throw new Error(`${spec.id} returned ${dims}-dim vectors, the catalog says ${spec.nativeDims}`)
  }
  if (tensor.data.length !== count * spec.nativeDims) {
    throw new Error(
      `${spec.id} returned ${tensor.data.length} values for ${count} texts at ${spec.nativeDims} dims`,
    )
  }
  const out: Float32Array[] = []
  for (let index = 0; index < count; index++) {
    const start = index * spec.nativeDims
    const native = Float32Array.from(tensor.data.subarray(start, start + spec.nativeDims))
    out.push(assertIndexable(reduceToIndexWidth(native, spec), spec.spaceId, index))
  }
  return out
}

export async function createTransformersEmbedding(
  options: TransformersEmbeddingOptions,
): Promise<LocalEmbeddingProvider> {
  const { spec, modelsRoot } = options
  if (spec.kind !== 'embedding') {
    throw new Error(`Model "${spec.id}" is a ${spec.kind} model, not an embedding one`)
  }

  const transformers = await (options.loadModule ?? loadTransformers)()
  transformers.env.allowRemoteModels = false
  transformers.env.allowLocalModels = true
  transformers.env.localModelPath = modelsRoot

  const devices = resolveDevices(
    options.device ?? 'auto',
    options.environment ?? nodeDeviceEnvironment(),
  )
  const { extractor, device } = await buildPipeline(transformers, spec, devices)
  options.onDevice?.(device)
  const batchSize = Math.max(1, options.batchSize ?? defaultBatchSize(device))

  const runBatch = async (texts: string[]): Promise<Float32Array[]> => {
    const tensor = await extractor(texts, { pooling: spec.pooling, normalize: false })
    return splitBatch(tensor, texts.length, spec)
  }

  return {
    modelId: spec.spaceId,
    dims: spec.dims,
    device,
    batchSize,

    embed: async (texts) => {
      if (texts.length === 0) return []
      const prefixed = texts.map((text) => spec.documentPrefix + text)
      const out: Float32Array[] = []
      for (let start = 0; start < prefixed.length; start += batchSize) {
        if (options.signal?.aborted === true) throw new Error('embedding was cancelled')
        out.push(...(await runBatch(prefixed.slice(start, start + batchSize))))
        options.onBatch?.(Math.min(start + batchSize, prefixed.length), prefixed.length)
      }
      return out
    },

    embedQuery: async (text) => {
      const [vector] = await runBatch([spec.queryPrefix + text])
      if (vector === undefined) throw new Error(`${spec.id} returned no vector for the query`)
      return vector
    },

    dispose: async () => {
      await extractor.dispose?.()
    },
  }
}
