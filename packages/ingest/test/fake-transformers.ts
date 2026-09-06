import type { FeatureExtractionPipeline, TransformersModule } from '../src/embeddings/transformers'
import type { ModelSpec } from '../src/models/catalog'
import type { RerankerModule, RerankerTokenizer } from '../src/rerank/transformers'

/**
 * A stand-in for `@huggingface/transformers` that behaves like the real one where it matters
 * and needs neither onnxruntime nor a downloaded model.
 *
 * The vectors it produces are the hashing trick, the same construction as core's
 * `createFakeEmbeddingProvider`: texts that share vocabulary land close together, texts that
 * share none land apart. That is enough to assert "the vector branch found the right chunk"
 * without a 300 MB download in CI, and it keeps every provider test deterministic.
 *
 * Deliberately *not* normalized and deliberately at the model's **native** width: the whole
 * point of the tests that use this is that `createTransformersEmbedding` is the thing that
 * reduces and normalizes.
 */

function hash32(token: string, salt: number): number {
  let hash = (2166136261 ^ salt) >>> 0
  for (let i = 0; i < token.length; i++) {
    hash = (hash ^ token.charCodeAt(i)) >>> 0
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash >>> 0
}

function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0)
}

/** One unnormalized vector per text, at `dims`, scaled well away from unit length so a test
 *  can tell whether the provider normalized. */
export function fakeVector(text: string, dims: number): Float32Array {
  const vector = new Float32Array(dims)
  for (const token of tokenize(text)) {
    const index = hash32(token, 0) % dims
    const sign = (hash32(token, 0x9e3779b9) & 1) === 0 ? 1 : -1
    vector[index] = (vector[index] as number) + sign * 7
  }
  if (vector.every((value) => value === 0)) vector[dims - 1] = 7
  return vector
}

export interface FakeTransformers extends TransformersModule {
  /** Every `(task, model, options)` the code under test asked for. */
  readonly loads: { task: string; model: string; options: Record<string, unknown> }[]
  /** Every batch handed to the pipeline, in order. */
  readonly batches: string[][]
  /** Options passed alongside each batch (pooling, normalize). */
  readonly callOptions: Record<string, unknown>[]
  /** Devices that must throw when asked for, so a test can drive the fallback. */
  readonly refuse: Set<string>
  disposed: number
}

export function createFakeTransformers(spec: ModelSpec): FakeTransformers {
  const fake: FakeTransformers = {
    env: { allowRemoteModels: true, localModelPath: '', allowLocalModels: false },
    loads: [],
    batches: [],
    callOptions: [],
    refuse: new Set(),
    disposed: 0,
    pipeline: async (task, model, options) => {
      fake.loads.push({ task, model, options })
      const device = String(options.device)
      if (fake.refuse.has(device)) throw new Error(`no ${device} execution provider`)
      if (fake.env.allowRemoteModels) throw new Error('the fake refuses to reach the network')

      const extractor = (async (texts: string[], callOptions: Record<string, unknown>) => {
        fake.batches.push([...texts])
        fake.callOptions.push(callOptions)
        const data = new Float32Array(texts.length * spec.nativeDims)
        texts.forEach((text, index) => {
          data.set(fakeVector(text, spec.nativeDims), index * spec.nativeDims)
        })
        return { dims: [texts.length, spec.nativeDims], data }
      }) as FeatureExtractionPipeline
      extractor.dispose = async () => {
        fake.disposed += 1
      }
      return extractor
    },
  }
  return fake
}

export interface FakeReranker extends RerankerModule {
  readonly pairs: { texts: string[]; textPairs: string[] }[]
  readonly refuse: Set<string>
  /** Logit for a (query, document) pair; defaults to the shared-token count. */
  score: (query: string, document: string) => number
  disposed: number
}

/** A cross-encoder stand-in: its logit is how many tokens the pair shares, so "more relevant"
 *  really does score higher and the ordering assertions mean something. */
export function createFakeRerankerModule(): FakeReranker {
  const fake: FakeReranker = {
    env: { allowRemoteModels: true, localModelPath: '', allowLocalModels: false },
    pairs: [],
    refuse: new Set(),
    disposed: 0,
    score: (query, document) => {
      const left = new Set(tokenize(query))
      return tokenize(document).filter((token) => left.has(token)).length
    },
    AutoTokenizer: {
      from_pretrained: async () => {
        const tokenizer: RerankerTokenizer = (texts, options) => {
          fake.pairs.push({ texts: [...texts], textPairs: [...(options.text_pair ?? [])] })
          return { texts, text_pair: options.text_pair }
        }
        return tokenizer
      },
    },
    AutoModelForSequenceClassification: {
      from_pretrained: async (_model, options) => {
        const device = String(options.device)
        if (fake.refuse.has(device)) throw new Error(`no ${device} execution provider`)
        const model = async (inputs: Record<string, unknown>) => {
          const texts = inputs.texts as string[]
          const pairs = (inputs.text_pair as string[] | undefined) ?? []
          return {
            logits: {
              data: texts.map((text, index) => fake.score(text, pairs[index] ?? '')),
            },
          }
        }
        model.dispose = async () => {
          fake.disposed += 1
        }
        return model
      },
    },
  }
  return fake
}
