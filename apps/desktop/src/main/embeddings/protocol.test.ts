import { describe, expect, it } from 'vitest'
import {
  decodeVector,
  embeddingHostModelSchema,
  embeddingHostRequestSchema,
  embeddingHostResponseSchema,
  encodeVector,
} from './protocol'

/**
 * The wire between main and the model host (sub-phase 6.3). Every message crossing a process
 * boundary is parsed, never cast, so this pins what the parser accepts and what it refuses.
 */

describe('the vector encoding', () => {
  it('round-trips exactly — these are float32 all the way through', () => {
    const vector = Float32Array.from({ length: 768 }, (_unused, i) => Math.sin(i) / 30)
    const decoded = decodeVector(encodeVector(vector), 768)
    expect([...decoded]).toEqual([...vector])
  })

  it('is far more compact than the JSON it replaces', () => {
    // 4,096 base64 characters against ~16,000 of JSON for a 768-dim vector — the reason this
    // is not just an array of numbers on the wire.
    const vector = Float32Array.from({ length: 768 }, (_unused, i) => Math.sin(i) / 30)
    expect(encodeVector(vector).length).toBeLessThan(JSON.stringify([...vector]).length / 3)
  })

  it('copies rather than viewing the pooled buffer it decoded from', () => {
    // `Buffer.from(base64)` is a view into Node's shared pool; handing that out as a
    // Float32Array would let an unrelated allocation rewrite a stored vector.
    const vector = Float32Array.from({ length: 4 }, (_unused, i) => i + 1)
    const decoded = decodeVector(encodeVector(vector), 4)
    expect(decoded.buffer.byteLength).toBe(16)
  })

  it('refuses a payload that is not the width it was told', () => {
    const vector = Float32Array.from([1, 2, 3])
    expect(() => decodeVector(encodeVector(vector), 768)).toThrow(/12 bytes for 768 dimensions/)
  })
})

describe('the model description', () => {
  it('accepts a catalog model with a device', () => {
    expect(
      embeddingHostModelSchema.safeParse({
        kind: 'local',
        modelId: 'embeddinggemma-300m',
        device: 'auto',
      }).success,
    ).toBe(true)
  })

  it('accepts a server, and rejects an impossible width', () => {
    expect(
      embeddingHostModelSchema.safeParse({
        kind: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'bge-m3',
        nativeDims: 1024,
      }).success,
    ).toBe(true)
    expect(
      embeddingHostModelSchema.safeParse({
        kind: 'ollama',
        baseUrl: 'http://x',
        model: 'm',
        nativeDims: 0,
      }).success,
    ).toBe(false)
  })

  it('rejects a device this build cannot ask ONNX Runtime for', () => {
    expect(
      embeddingHostModelSchema.safeParse({ kind: 'local', modelId: 'x', device: 'tpu' }).success,
    ).toBe(false)
  })
})

describe('the request schema', () => {
  const model = { kind: 'local' as const, modelId: 'embeddinggemma-300m', device: 'cpu' as const }

  it('accepts the four kinds the host understands', () => {
    for (const request of [
      { type: 'embedQuery', id: 'r1', model, text: 'la sangre' },
      {
        type: 'rerank',
        id: 'r2',
        modelId: 'bge-reranker-v2-m3',
        device: 'cpu',
        query: 'q',
        documents: [],
      },
      { type: 'unload' },
      { type: 'shutdown' },
    ]) {
      expect(embeddingHostRequestSchema.safeParse(request).success, JSON.stringify(request)).toBe(
        true,
      )
    }
  })

  it('caps how many candidates one rerank may carry', () => {
    // The fusion hands over 50; 200 is generous headroom and still a bound, because this
    // array crosses a process boundary and is structured-cloned on the way.
    const documents = Array.from({ length: 201 }, (_unused, index) => ({
      id: `c${index}`,
      text: 'x',
      score: 0,
    }))
    expect(
      embeddingHostRequestSchema.safeParse({
        type: 'rerank',
        id: 'r',
        modelId: 'bge-reranker-v2-m3',
        device: 'cpu',
        query: 'q',
        documents,
      }).success,
    ).toBe(false)
  })

  it('rejects a request with no correlation id', () => {
    // Without it the answer cannot be matched to its caller, and a search box can legitimately
    // have two queries outstanding at once.
    expect(
      embeddingHostRequestSchema.safeParse({ type: 'embedQuery', model, text: 'x' }).success,
    ).toBe(false)
  })
})

describe('the response schema', () => {
  it('accepts what the host sends, and rejects an unknown type', () => {
    expect(embeddingHostResponseSchema.safeParse({ type: 'ready' }).success).toBe(true)
    expect(
      embeddingHostResponseSchema.safeParse({
        type: 'embedding',
        id: 'r1',
        modelId: 'embeddinggemma-300m@768',
        vector: 'AAAA',
        dims: 768,
        ms: 12,
      }).success,
    ).toBe(true)
    expect(embeddingHostResponseSchema.safeParse({ type: 'exploded' }).success).toBe(false)
  })
})
