import { type EmbeddingProvider, embedQuery } from '@retenia/core'
import { createFakeEmbeddingProvider } from '@retenia/core/testing'
import { describe, expect, it } from 'vitest'
import { createFakeTransformers } from '../../test/fake-transformers'
import { requireModel } from '../models/catalog'
import { createOllamaEmbedding } from './ollama'
import { createTransformersEmbedding } from './transformers'

/**
 * The contract every `EmbeddingProvider` has to satisfy, run against each implementation.
 *
 * These are not "does the model work" tests — a hashing-trick fake stands in for the real
 * ONNX weights, which is what keeps them runnable in CI without a 300 MB download. They are
 * the invariants the *index* depends on, and each one is a bug the storage layer could not
 * detect on its own:
 *
 *  - vectors are unit length, because `quantizeToInt8` maps [-1, 1] onto the int8 range
 *    assuming exactly that (`packages/db/src/search.ts`);
 *  - they are exactly `dims` wide, because vec0 is a fixed-width table;
 *  - the batch comes back in the order it went in, because the caller pairs vector `i` with
 *    chunk `i` and a silent reshuffle would just look like "search got worse";
 *  - `modelId` names the space, because a query only ever compares vectors of one.
 */

const GEMMA = requireModel('embeddinggemma-300m')
const BGE = requireModel('bge-m3')

const TEXTS = [
  'La práctica de recuperación produce memorias más duraderas.',
  'The heart pumps blood through the circulatory system.',
  'Las mitocondrias son los orgánulos que producen ATP.',
  '',
  '   ',
  '¿Qué es la retención a largo plazo?',
]

interface Case {
  name: string
  dims: number
  build: () => Promise<EmbeddingProvider>
}

/** A local server whose vectors are the same hashing trick, at a chosen native width. */
function ollamaFetch(dims: number): typeof globalThis.fetch {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { input: string[] }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: body.input.map((text, index) => ({
          index,
          // Never all-zero, the way a real model is never all-zero: the sentinel token
          // alone already produces a direction.
          embedding: Array.from({ length: dims }, (_unused, at) =>
            text.length === 0 ? (at % 7) - 3 : (text.charCodeAt(at % text.length) % 11) - 5,
          ),
        })),
      }),
    }
  }) as unknown as typeof globalThis.fetch
}

const CASES: Case[] = [
  {
    name: 'the deterministic fake (core)',
    dims: 768,
    build: async () => createFakeEmbeddingProvider(),
  },
  {
    name: 'TransformersEmbedding, a model at the index width',
    dims: GEMMA.dims,
    build: () =>
      createTransformersEmbedding({
        spec: GEMMA,
        modelsRoot: '/models',
        loadModule: async () => createFakeTransformers(GEMMA),
        environment: { platform: 'linux', hasWebGpu: false, hasCudaProvider: false },
      }),
  },
  {
    name: 'TransformersEmbedding, a model that has to be projected',
    dims: BGE.dims,
    build: () =>
      createTransformersEmbedding({
        spec: BGE,
        modelsRoot: '/models',
        loadModule: async () => createFakeTransformers(BGE),
        environment: { platform: 'linux', hasWebGpu: false, hasCudaProvider: false },
      }),
  },
  {
    name: 'OllamaEmbedding, native width',
    dims: 768,
    build: async () =>
      createOllamaEmbedding({
        baseUrl: 'http://127.0.0.1:11434',
        model: 'bge-m3',
        nativeDims: 768,
        fetch: ollamaFetch(768),
      }),
  },
  {
    name: 'OllamaEmbedding, reduced width',
    dims: 768,
    build: async () =>
      createOllamaEmbedding({
        baseUrl: 'http://127.0.0.1:11434',
        model: 'qwen3-embedding',
        nativeDims: 1024,
        dims: 768,
        reduction: 'matryoshka',
        fetch: ollamaFetch(1024),
      }),
  },
]

function norm(vector: Float32Array): number {
  let sum = 0
  for (const value of vector) sum += value * value
  return Math.sqrt(sum)
}

describe.each(CASES)('EmbeddingProvider contract: $name', ({ dims, build }) => {
  it('declares a non-empty space id and the width it returns', async () => {
    const provider = await build()
    expect(provider.modelId.length).toBeGreaterThan(0)
    expect(provider.dims).toBe(dims)
  })

  it('returns one vector per text, in order, at the declared width', async () => {
    const provider = await build()
    const vectors = await provider.embed(TEXTS)
    expect(vectors).toHaveLength(TEXTS.length)
    for (const vector of vectors) {
      expect(vector).toBeInstanceOf(Float32Array)
      expect(vector).toHaveLength(provider.dims)
    }
  })

  it('returns unit vectors, which is what int8 quantization assumes', async () => {
    const provider = await build()
    for (const vector of await provider.embed(TEXTS)) {
      // Empty and whitespace-only texts are in TEXTS on purpose: a chunk of a scanned page
      // can be blank, and a zero-norm vector would quantize to a row of zeros that is
      // equidistant from everything.
      expect(norm(vector)).toBeGreaterThan(0.9)
      expect(norm(vector)).toBeCloseTo(1, 4)
    }
  })

  it('has no NaN or Infinity anywhere — one would poison every distance in the partition', async () => {
    const provider = await build()
    for (const vector of await provider.embed(TEXTS)) {
      expect(vector.every((value) => Number.isFinite(value))).toBe(true)
    }
  })

  it('is stable: the same text embeds the same way twice', async () => {
    const provider = await build()
    const [first] = await provider.embed([TEXTS[0] as string])
    const [second] = await provider.embed([TEXTS[0] as string])
    expect([...(first as Float32Array)]).toEqual([...(second as Float32Array)])
  })

  it('does not depend on the batch it was embedded in', async () => {
    // The chunk at position 3 of a page must get the same vector as it would alone; anything
    // else means a re-index silently changes what is already stored.
    const provider = await build()
    const batched = await provider.embed(TEXTS)
    const [alone] = await provider.embed([TEXTS[2] as string])
    expect([...(batched[2] as Float32Array)]).toEqual([...(alone as Float32Array)])
  })

  it('answers an empty batch with an empty list', async () => {
    const provider = await build()
    expect(await provider.embed([])).toEqual([])
  })

  it('embeds a query to the same width, through embedQuery() whether or not it has one', async () => {
    const provider = await build()
    const vector = await embedQuery(provider, '¿cómo circula la sangre?')
    expect(vector).toHaveLength(provider.dims)
    expect(norm(vector)).toBeCloseTo(1, 4)
  })
})

describe('embedQuery', () => {
  it('falls back to the document side for a symmetric provider', async () => {
    const provider = createFakeEmbeddingProvider()
    expect(provider.embedQuery).toBeUndefined()
    const [asDocument] = await provider.embed(['la sangre'])
    expect([...(await embedQuery(provider, 'la sangre'))]).toEqual([
      ...(asDocument as Float32Array),
    ])
  })

  it('uses the query side when the provider has one', async () => {
    const provider = await createTransformersEmbedding({
      spec: GEMMA,
      modelsRoot: '/models',
      loadModule: async () => createFakeTransformers(GEMMA),
      environment: { platform: 'linux', hasWebGpu: false, hasCudaProvider: false },
    })
    const [asDocument] = await provider.embed(['la sangre'])
    expect([...(await embedQuery(provider, 'la sangre'))]).not.toEqual([
      ...(asDocument as Float32Array),
    ])
  })
})

describe('the last gate before the index', () => {
  it('refuses a zero vector instead of storing a row equidistant from everything', async () => {
    // sqlite-vec is brute force: a zero row sits at distance 1 from every unit vector and so
    // turns up in *any* KNN result. Failing the chunk is the recoverable outcome.
    const provider = createOllamaEmbedding({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'broken',
      nativeDims: 8,
      fetch: (async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ data: [{ index: 0, embedding: new Array(8).fill(0) }] }),
      })) as unknown as typeof globalThis.fetch,
    })
    await expect(provider.embed(['blank page'])).rejects.toThrow(/unit vectors only/)
  })

  it('refuses a non-finite value instead of poisoning every distance in the partition', async () => {
    const provider = createOllamaEmbedding({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'broken',
      nativeDims: 4,
      fetch: (async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ data: [{ index: 0, embedding: [1, Number.NaN, 0, 0] }] }),
      })) as unknown as typeof globalThis.fetch,
    })
    await expect(provider.embed(['x'])).rejects.toThrow(/non-finite value/)
  })
})
