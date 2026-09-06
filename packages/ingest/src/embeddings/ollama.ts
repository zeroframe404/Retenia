import type { EmbeddingProvider } from '@retenia/core'
import { assertIndexable, l2Normalize, randomProject, truncateMatryoshka } from './reduce'

/**
 * Ollama (and LM Studio, and anything else that speaks the same route) as an embedding
 * provider, over its OpenAI-compatible `/v1/embeddings` endpoint
 * (`docs/spec/05-ingestion-rag.md` §3; `docs/spec/01-decisions.md` §5: "Ollama/LM Studio as
 * one more provider with cloud fallback").
 *
 * It is deliberately *not* part of the catalog: the models here are ones the user pulled
 * themselves (`ollama pull qwen3-embedding`, `bge-m3`), on a server this app does not
 * manage, and there is no manifest to hash them against. What the app can still guarantee is
 * the part that matters for the index — every vector is unit-length and exactly
 * `INDEX_DIMENSIONS` wide, and the space it belongs to is named after the server's model tag
 * *and* the reduction applied, so it can never be confused with the local ONNX space of the
 * same model.
 */

export interface OllamaEmbeddingOptions {
  /** Base URL of the server, e.g. `http://127.0.0.1:11434`. A trailing `/v1` is optional. */
  baseUrl: string
  /** The tag as the server knows it: `qwen3-embedding`, `bge-m3`, `embeddinggemma`. */
  model: string
  /** The server's native output width, which the caller learns from `probe()` or settings. */
  nativeDims: number
  /** Width the index stores. Defaults to `nativeDims` (no reduction). */
  dims?: number
  /**
   * How to get from `nativeDims` to `dims`. `matryoshka` only for models trained that way
   * (qwen3-embedding is; bge-m3 is not) — the default is the safe one.
   */
  reduction?: 'matryoshka' | 'random-projection'
  /** Prefix for the document side, when the model wants one. */
  documentPrefix?: string
  /** Prefix for the query side. */
  queryPrefix?: string
  /** Texts per request. Ollama batches server-side; this bounds the request body. */
  batchSize?: number
  /** Per-request timeout. A local model that is still loading can take a while on the first
   *  call, and a server that is not there should fail fast rather than hang a job. */
  timeoutMs?: number
  fetch?: typeof globalThis.fetch
  signal?: { readonly aborted: boolean }
}

export const DEFAULT_OLLAMA_BATCH_SIZE = 32
export const DEFAULT_OLLAMA_TIMEOUT_MS = 120_000

export class OllamaUnavailableError extends Error {
  constructor(baseUrl: string, cause: unknown) {
    super(
      `No embedding server answered at ${baseUrl}: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
    this.name = 'OllamaUnavailableError'
  }
}

/** `http://host:11434` and `http://host:11434/v1` both mean the same server. */
export function embeddingsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? `${trimmed}/embeddings` : `${trimmed}/v1/embeddings`
}

interface OpenAiEmbeddingResponse {
  data?: { index?: number; embedding?: number[] }[]
}

/**
 * The response's `index` is authoritative, not the array order: the OpenAI shape allows a
 * server to answer out of order, and silently pairing the wrong vector with the wrong chunk
 * is the kind of bug that only shows up as "search got worse".
 */
function orderVectors(payload: OpenAiEmbeddingResponse, expected: number): number[][] {
  const data = payload.data
  if (!Array.isArray(data) || data.length !== expected) {
    throw new Error(
      `the embedding server returned ${data?.length ?? 0} vectors for ${expected} texts`,
    )
  }
  const out: number[][] = new Array(expected)
  data.forEach((entry, position) => {
    const index = typeof entry.index === 'number' ? entry.index : position
    if (!Number.isInteger(index) || index < 0 || index >= expected) {
      throw new Error(`the embedding server returned an out-of-range index ${index}`)
    }
    if (!Array.isArray(entry.embedding)) {
      throw new Error(`the embedding server returned no vector at index ${index}`)
    }
    out[index] = entry.embedding
  })
  if (out.some((vector) => vector === undefined)) {
    throw new Error('the embedding server left a gap in its result indexes')
  }
  return out
}

export function createOllamaEmbedding(options: OllamaEmbeddingOptions): EmbeddingProvider {
  const dims = options.dims ?? options.nativeDims
  const reduction = options.reduction ?? 'random-projection'
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_OLLAMA_BATCH_SIZE)
  const timeoutMs = options.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS
  const doFetch = options.fetch ?? globalThis.fetch
  const url = embeddingsUrl(options.baseUrl)

  if (dims > options.nativeDims) {
    throw new RangeError(
      `cannot widen ${options.model} from ${options.nativeDims} to ${dims} dimensions`,
    )
  }

  // The space id says server, model and reduction. Two of the three would not be enough: the
  // same tag truncated to 768 and projected to 768 are different spaces, and the local ONNX
  // build of "bge-m3" is a third one again.
  const modelId =
    dims === options.nativeDims
      ? `ollama:${options.model}@${dims}`
      : `ollama:${options.model}@${dims}/${reduction === 'matryoshka' ? 'mrl' : 'rp'}`

  const reduce = (values: number[], at: number): Float32Array => {
    if (values.length !== options.nativeDims) {
      throw new Error(
        `${options.model} returned a ${values.length}-dim vector, expected ${options.nativeDims}`,
      )
    }
    const native = Float32Array.from(values)
    const reduced =
      dims === options.nativeDims
        ? l2Normalize(native)
        : reduction === 'matryoshka'
          ? truncateMatryoshka(native, dims)
          : randomProject(native, dims, modelId)
    return assertIndexable(reduced, modelId, at)
  }

  const request = async (texts: string[]): Promise<Float32Array[]> => {
    const timeout = AbortSignal.timeout(timeoutMs)
    let response: Response
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: options.model, input: texts }),
        signal: timeout,
      })
    } catch (error) {
      throw new OllamaUnavailableError(options.baseUrl, error)
    }
    if (!response.ok) {
      throw new Error(
        `${response.status} ${response.statusText} from ${url} for model ${options.model}`,
      )
    }
    const payload = (await response.json()) as OpenAiEmbeddingResponse
    return orderVectors(payload, texts.length).map((values, at) => reduce(values, at))
  }

  const embedAll = async (texts: readonly string[], prefix: string): Promise<Float32Array[]> => {
    if (texts.length === 0) return []
    const prefixed = texts.map((text) => prefix + text)
    const out: Float32Array[] = []
    for (let start = 0; start < prefixed.length; start += batchSize) {
      if (options.signal?.aborted === true) throw new Error('embedding was cancelled')
      out.push(...(await request(prefixed.slice(start, start + batchSize))))
    }
    return out
  }

  const queryPrefix = options.queryPrefix ?? ''
  const documentPrefix = options.documentPrefix ?? ''

  const provider: EmbeddingProvider = {
    modelId,
    dims,
    embed: (texts) => embedAll(texts, documentPrefix),
  }
  // Only declared when the model is actually asymmetric, so `embedQuery()`'s fallback stays
  // the honest answer for a symmetric one.
  if (queryPrefix !== documentPrefix) {
    provider.embedQuery = async (text) => {
      const [vector] = await embedAll([text], queryPrefix)
      if (vector === undefined) throw new Error(`${options.model} returned no vector for the query`)
      return vector
    }
  }
  return provider
}

/**
 * Asks the server for one vector and reports how wide it is, so the settings screen can offer
 * a model without the user having to know its dimensionality — and so a misconfigured width
 * fails at "Test connection" rather than halfway through indexing a library.
 */
export async function probeOllamaEmbedding(
  options: Pick<OllamaEmbeddingOptions, 'baseUrl' | 'model' | 'fetch' | 'timeoutMs'>,
): Promise<{ dims: number }> {
  const doFetch = options.fetch ?? globalThis.fetch
  const url = embeddingsUrl(options.baseUrl)
  let response: Response
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: options.model, input: ['retenia'] }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS),
    })
  } catch (error) {
    throw new OllamaUnavailableError(options.baseUrl, error)
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`)
  }
  const payload = (await response.json()) as OpenAiEmbeddingResponse
  const vector = payload.data?.[0]?.embedding
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error(`${options.model} returned no usable vector`)
  }
  return { dims: vector.length }
}
