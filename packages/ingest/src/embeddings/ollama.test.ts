import { describe, expect, it, vi } from 'vitest'
import {
  createOllamaEmbedding,
  embeddingsUrl,
  OllamaUnavailableError,
  probeOllamaEmbedding,
} from './ollama'

const BASE = 'http://127.0.0.1:11434'

function norm(vector: Float32Array): number {
  let sum = 0
  for (const value of vector) sum += value * value
  return Math.sqrt(sum)
}

interface Call {
  url: string
  body: { model: string; input: string[] }
}

/** A server that answers with a deterministic vector per text, at `dims`. */
function fakeServer(dims: number, options: { shuffle?: boolean; status?: number } = {}) {
  const calls: Call[] = []
  const fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Call['body']
    calls.push({ url, body })
    if (options.status !== undefined && options.status >= 400) {
      return {
        ok: false,
        status: options.status,
        statusText: 'Bad Request',
        json: async () => ({}),
      }
    }
    const data = body.input.map((text, index) => ({
      index,
      // `+ 1` so no input can produce the all-zero vector a real model never returns —
      // that case has its own test in `contract.test.ts`.
      embedding: Array.from(
        { length: dims },
        (_unused, at) => ((text.charCodeAt(at % text.length) + at) % 13) - 6 + 1,
      ),
    }))
    // Ollama is free to answer out of order; the provider must honour `index`, not position.
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ data: options.shuffle === true ? [...data].reverse() : data }),
    }
  }) as unknown as typeof globalThis.fetch
  return { calls, fetch }
}

describe('embeddingsUrl', () => {
  it('accepts a base with or without the /v1 the user may have pasted', () => {
    expect(embeddingsUrl(BASE)).toBe(`${BASE}/v1/embeddings`)
    expect(embeddingsUrl(`${BASE}/v1`)).toBe(`${BASE}/v1/embeddings`)
    expect(embeddingsUrl(`${BASE}/`)).toBe(`${BASE}/v1/embeddings`)
  })
})

describe('createOllamaEmbedding', () => {
  it('returns unit vectors at the declared width', async () => {
    const server = fakeServer(1024)
    const provider = createOllamaEmbedding({
      baseUrl: BASE,
      model: 'bge-m3',
      nativeDims: 1024,
      dims: 768,
      fetch: server.fetch,
    })
    const [vector] = await provider.embed(['la sangre circula'])
    expect(vector).toHaveLength(768)
    expect(norm(vector as Float32Array)).toBeCloseTo(1, 5)
  })

  it('names a space that pins the server, the model and the reduction', () => {
    const server = fakeServer(1024)
    const truncated = createOllamaEmbedding({
      baseUrl: BASE,
      model: 'qwen3-embedding',
      nativeDims: 1024,
      dims: 768,
      reduction: 'matryoshka',
      fetch: server.fetch,
    })
    const projected = createOllamaEmbedding({
      baseUrl: BASE,
      model: 'qwen3-embedding',
      nativeDims: 1024,
      dims: 768,
      fetch: server.fetch,
    })
    const native = createOllamaEmbedding({
      baseUrl: BASE,
      model: 'qwen3-embedding',
      nativeDims: 768,
      fetch: server.fetch,
    })
    // Three different spaces from one model tag — and none of them collides with the local
    // ONNX catalog's `bge-m3@768`.
    expect(truncated.modelId).toBe('ollama:qwen3-embedding@768/mrl')
    expect(projected.modelId).toBe('ollama:qwen3-embedding@768/rp')
    expect(native.modelId).toBe('ollama:qwen3-embedding@768')
  })

  it('pairs vectors with texts by the response’s index, not by array position', async () => {
    const ordered = fakeServer(768)
    const shuffled = fakeServer(768, { shuffle: true })
    const make = (server: ReturnType<typeof fakeServer>) =>
      createOllamaEmbedding({
        baseUrl: BASE,
        model: 'bge-m3',
        nativeDims: 768,
        fetch: server.fetch,
      })

    const texts = ['alpha', 'beta gamma', 'delta epsilon zeta']
    const straight = await make(ordered).embed(texts)
    const reversed = await make(shuffled).embed(texts)
    expect(reversed.map((vector) => [...vector])).toEqual(straight.map((vector) => [...vector]))
  })

  it('refuses a response with a gap or an out-of-range index', async () => {
    const fetch = (async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ data: [{ index: 5, embedding: [1, 2, 3] }] }),
    })) as unknown as typeof globalThis.fetch
    const provider = createOllamaEmbedding({
      baseUrl: BASE,
      model: 'bge-m3',
      nativeDims: 3,
      fetch,
    })
    await expect(provider.embed(['a'])).rejects.toThrow(/out-of-range index/)
  })

  it('refuses a vector that is not the width the settings promised', async () => {
    const server = fakeServer(512)
    const provider = createOllamaEmbedding({
      baseUrl: BASE,
      model: 'bge-m3',
      nativeDims: 1024,
      dims: 768,
      fetch: server.fetch,
    })
    await expect(provider.embed(['a'])).rejects.toThrow(/512-dim vector, expected 1024/)
  })

  it('batches, so a book is not one request body', async () => {
    const server = fakeServer(768)
    const provider = createOllamaEmbedding({
      baseUrl: BASE,
      model: 'bge-m3',
      nativeDims: 768,
      batchSize: 2,
      fetch: server.fetch,
    })
    await provider.embed(['a', 'b', 'c', 'd', 'e'])
    expect(server.calls.map((call) => call.body.input.length)).toEqual([2, 2, 1])
  })

  it('only offers a query side when the model really is asymmetric', async () => {
    const server = fakeServer(768)
    const symmetric = createOllamaEmbedding({
      baseUrl: BASE,
      model: 'bge-m3',
      nativeDims: 768,
      fetch: server.fetch,
    })
    const asymmetric = createOllamaEmbedding({
      baseUrl: BASE,
      model: 'embeddinggemma',
      nativeDims: 768,
      queryPrefix: 'task: search result | query: ',
      documentPrefix: 'title: none | text: ',
      fetch: server.fetch,
    })
    expect(symmetric.embedQuery).toBeUndefined()

    await asymmetric.embedQuery?.('la sangre')
    expect(server.calls.at(-1)?.body.input).toEqual(['task: search result | query: la sangre'])
  })

  it('says which server did not answer, rather than surfacing a bare fetch error', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const provider = createOllamaEmbedding({
      baseUrl: BASE,
      model: 'bge-m3',
      nativeDims: 768,
      fetch: fetch as unknown as typeof globalThis.fetch,
    })
    await expect(provider.embed(['a'])).rejects.toThrow(OllamaUnavailableError)
    await expect(provider.embed(['a'])).rejects.toThrow(/127\.0\.0\.1:11434.*ECONNREFUSED/)
  })

  it('reports the status when the server rejects the request', async () => {
    const server = fakeServer(768, { status: 400 })
    const provider = createOllamaEmbedding({
      baseUrl: BASE,
      model: 'nope',
      nativeDims: 768,
      fetch: server.fetch,
    })
    await expect(provider.embed(['a'])).rejects.toThrow(/400 Bad Request/)
  })

  it('cannot be configured to widen a model', () => {
    expect(() =>
      createOllamaEmbedding({ baseUrl: BASE, model: 'small', nativeDims: 384, dims: 768 }),
    ).toThrow(/cannot widen/)
  })
})

describe('probeOllamaEmbedding', () => {
  it('reports the server’s real width, so settings need not be told it', async () => {
    const server = fakeServer(1024)
    expect(
      await probeOllamaEmbedding({ baseUrl: BASE, model: 'bge-m3', fetch: server.fetch }),
    ).toEqual({ dims: 1024 })
  })

  it('fails clearly when nothing is listening', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(
      probeOllamaEmbedding({
        baseUrl: BASE,
        model: 'bge-m3',
        fetch: fetch as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow(OllamaUnavailableError)
  })
})
