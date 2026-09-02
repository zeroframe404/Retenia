import { describe, expect, it } from 'vitest'
import { createFakeEmbeddingProvider, fakeEmbeddingTokens } from './fake-embedding-provider'

/** Cosine similarity; every vector the provider returns is unit-length, so this is the dot. */
function similarity(left: Float32Array, right: Float32Array): number {
  let dot = 0
  for (let i = 0; i < left.length; i++) dot += (left[i] as number) * (right[i] as number)
  return dot
}

describe('createFakeEmbeddingProvider()', () => {
  const provider = createFakeEmbeddingProvider()

  it('announces the model and the width it produces', async () => {
    expect(provider.dims).toBe(768)
    expect(provider.modelId).toBe('fake-hash-768')
    const [vector] = await provider.embed(['hola'])
    expect(vector).toHaveLength(768)
    expect(createFakeEmbeddingProvider({ dims: 384, modelId: 'tiny' }).dims).toBe(384)
    expect(() => createFakeEmbeddingProvider({ dims: 0 })).toThrow(RangeError)
  })

  it('is deterministic: the same text is always the same vector', async () => {
    const [first] = await provider.embed(['El corazón bombea sangre'])
    const [second] = await createFakeEmbeddingProvider().embed(['El corazón bombea sangre'])
    expect([...(first as Float32Array)]).toEqual([...(second as Float32Array)])
  })

  it('returns one vector per input, in order', async () => {
    const vectors = await provider.embed(['uno', 'dos', 'tres'])
    expect(vectors).toHaveLength(3)
    const [one] = await provider.embed(['dos'])
    expect([...(vectors[1] as Float32Array)]).toEqual([...(one as Float32Array)])
  })

  it('produces unit vectors, which is what the int8 index assumes', async () => {
    for (const vector of await provider.embed(['El corazón bombea sangre', 'x', ''])) {
      expect(similarity(vector as Float32Array, vector as Float32Array)).toBeCloseTo(1, 5)
      for (const value of vector as Float32Array) expect(Math.abs(value)).toBeLessThanOrEqual(1)
    }
  })

  it('puts texts that share vocabulary closer than texts that share none', async () => {
    const [about, related, unrelated] = await provider.embed([
      'El corazón bombea la sangre por el cuerpo',
      'La sangre del corazón llega al cuerpo',
      'La glucólisis degrada la glucosa en piruvato',
    ])
    expect(similarity(about as Float32Array, related as Float32Array)).toBeGreaterThan(
      similarity(about as Float32Array, unrelated as Float32Array),
    )
  })

  it('ignores case and diacritics, exactly as the FTS5 tokenizer does', async () => {
    const [plain, accented] = await provider.embed(['corazon', 'CORAZÓN'])
    expect([...(plain as Float32Array)]).toEqual([...(accented as Float32Array)])
    expect(fakeEmbeddingTokens('¡El corazón, bombea!')).toEqual(['el', 'corazon', 'bombea'])
  })

  it('still returns a usable vector for an empty or punctuation-only text', async () => {
    const [empty, punctuation] = await provider.embed(['', '¿?¡!'])
    expect(similarity(empty as Float32Array, empty as Float32Array)).toBeCloseTo(1, 5)
    expect([...(empty as Float32Array)]).toEqual([...(punctuation as Float32Array)])
  })
})
