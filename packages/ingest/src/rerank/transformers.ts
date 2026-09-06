import type { RerankDocument, Reranker, RerankOptions, RerankResult } from '@retenia/core'
import {
  type DeviceEnvironment,
  type EmbeddingDevice,
  nodeDeviceEnvironment,
  resolveDevices,
} from '../embeddings/device'
import type { ModelSpec } from '../models/catalog'

/**
 * The local reranker: a cross-encoder (bge-reranker-v2-m3) reading the query and one
 * candidate *together*, which is what makes it strictly better than either index branch and
 * also what makes it the last stage rather than a retrieval stage
 * (`docs/spec/05-ingestion-rag.md` §3, §4: "local: mxbai-rerank-base-v2 or
 * bge-reranker-v2-m3, free, 0.2–1 s per 20 documents on CPU").
 *
 * Unlike the embedding side this uses the tokenizer and the model directly instead of a
 * pipeline: a reranker's input is a *pair* (`text`, `text_pair`), and the text-classification
 * pipeline only ever tokenizes single sequences. Passing the candidate as a second segment is
 * the whole point — a cross-encoder that saw them concatenated into one sequence would be
 * scoring something else.
 *
 * Same two rules as `../embeddings/transformers.ts`: nothing reaches the network
 * (`allowRemoteModels = false` over a hash-verified model directory), and the heavy import is
 * dynamic so only the process that actually reranks pays for onnxruntime.
 */

export interface RerankerTokenizerOutput {
  [key: string]: unknown
}

export type RerankerTokenizer = (
  texts: string[],
  options: { text_pair?: string[]; padding?: boolean; truncation?: boolean },
) => RerankerTokenizerOutput

export interface RerankerModel {
  (inputs: RerankerTokenizerOutput): Promise<{ logits: { data: ArrayLike<number> } }>
  dispose?(): Promise<void>
}

/** The bits of `@huggingface/transformers` this module uses; structural so tests can fake it. */
export interface RerankerModule {
  env: { allowRemoteModels: boolean; localModelPath: string; allowLocalModels?: boolean }
  AutoTokenizer: {
    from_pretrained(model: string, options: Record<string, unknown>): Promise<RerankerTokenizer>
  }
  AutoModelForSequenceClassification: {
    from_pretrained(model: string, options: Record<string, unknown>): Promise<RerankerModel>
  }
}

export interface TransformersRerankerOptions {
  spec: ModelSpec
  modelsRoot: string
  device?: EmbeddingDevice
  /** Pairs per forward pass. The fusion hands the reranker 50 candidates at most. */
  batchSize?: number
  loadModule?: () => Promise<RerankerModule>
  environment?: DeviceEnvironment
  onDevice?: (device: string) => void
  signal?: { readonly aborted: boolean }
}

export interface LocalReranker extends Reranker {
  readonly device: string
  dispose(): Promise<void>
}

export const DEFAULT_RERANK_BATCH_SIZE = 16

/** Logit → (0, 1). Monotone, so it changes no ordering; it just makes the score readable
 *  next to a fusion score in the UI and in a log. */
function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value))
}

async function loadTransformers(): Promise<RerankerModule> {
  return (await import('@huggingface/transformers')) as unknown as RerankerModule
}

export async function createTransformersReranker(
  options: TransformersRerankerOptions,
): Promise<LocalReranker> {
  const { spec, modelsRoot } = options
  if (spec.kind !== 'reranker') {
    throw new Error(`Model "${spec.id}" is a ${spec.kind} model, not a reranker`)
  }

  const transformers = await (options.loadModule ?? loadTransformers)()
  transformers.env.allowRemoteModels = false
  transformers.env.allowLocalModels = true
  transformers.env.localModelPath = modelsRoot

  const devices = resolveDevices(
    options.device ?? 'auto',
    options.environment ?? nodeDeviceEnvironment(),
  )

  const tokenizer = await transformers.AutoTokenizer.from_pretrained(spec.repo, {
    local_files_only: true,
  })

  const failures: string[] = []
  let model: RerankerModel | undefined
  let device = 'cpu'
  for (const candidate of devices) {
    try {
      model = await transformers.AutoModelForSequenceClassification.from_pretrained(spec.repo, {
        dtype: spec.dtype,
        device: candidate,
        local_files_only: true,
      })
      device = candidate
      break
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (model === undefined) {
    throw new Error(`Could not load ${spec.id} on any execution provider (${failures.join('; ')})`)
  }
  options.onDevice?.(device)

  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_RERANK_BATCH_SIZE)
  const loaded = model

  const scoreBatch = async (query: string, texts: string[]): Promise<number[]> => {
    const inputs = tokenizer(
      texts.map(() => query),
      { text_pair: texts, padding: true, truncation: true },
    )
    const { logits } = await loaded(inputs)
    if (logits.data.length !== texts.length) {
      throw new Error(
        `${spec.id} returned ${logits.data.length} scores for ${texts.length} candidates`,
      )
    }
    return Array.from({ length: texts.length }, (_unused, index) =>
      sigmoid(logits.data[index] as number),
    )
  }

  return {
    id: spec.id,
    device,

    rerank: async (
      query: string,
      documents: readonly RerankDocument[],
      rerankOptions?: RerankOptions,
    ): Promise<readonly RerankResult[]> => {
      if (documents.length === 0) return []
      const scored: RerankResult[] = []
      for (let start = 0; start < documents.length; start += batchSize) {
        if (options.signal?.aborted === true) throw new Error('reranking was cancelled')
        const batch = documents.slice(start, start + batchSize)
        const scores = await scoreBatch(
          query,
          batch.map((document) => document.text),
        )
        batch.forEach((document, index) => {
          scored.push({ id: document.id, score: scores[index] as number })
        })
      }
      // Ties broken by id so the order is stable run to run; ids are UUIDv7, so that is also
      // insertion order, which is the least surprising tie-break a reader could get.
      scored.sort((left, right) =>
        left.score === right.score ? left.id.localeCompare(right.id) : right.score - left.score,
      )
      const topN = rerankOptions?.topN
      return topN === undefined ? scored : scored.slice(0, Math.max(0, topN))
    },

    dispose: async () => {
      await loaded.dispose?.()
    },
  }
}
