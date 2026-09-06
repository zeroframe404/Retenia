import { passthroughReranker, type RerankDocument } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { createFakeRerankerModule } from '../../test/fake-transformers'
import { requireModel } from '../models/catalog'
import { createTransformersReranker } from './transformers'

const SPEC = requireModel('bge-reranker-v2-m3')
const ROOT = '/models'

const CANDIDATES: RerankDocument[] = [
  { id: 'c1', text: 'Las plantas fabrican azúcares con la luz del sol.', score: 0.1 },
  { id: 'c2', text: 'La fotosíntesis convierte luz en energía química.', score: 0.2 },
  { id: 'c3', text: 'El motor de combustión quema gasolina.', score: 0.9 },
]

const QUERY = 'la fotosíntesis convierte luz'

const build = (overrides: Record<string, unknown> = {}) => {
  const fake = createFakeRerankerModule()
  return {
    fake,
    reranker: createTransformersReranker({
      spec: SPEC,
      modelsRoot: ROOT,
      loadModule: async () => fake,
      environment: { platform: 'linux', hasWebGpu: false, hasCudaProvider: false },
      ...overrides,
    }),
  }
}

describe('createTransformersReranker', () => {
  it('loads from disk only, never from the network', async () => {
    const { fake, reranker } = build()
    await reranker
    expect(fake.env.allowRemoteModels).toBe(false)
    expect(fake.env.localModelPath).toBe(ROOT)
  })

  it('scores the query against each candidate as a *pair*, not as one sequence', async () => {
    // The whole reason this uses the tokenizer directly instead of a text-classification
    // pipeline: a cross-encoder that saw the two concatenated would be scoring something else.
    const { fake, reranker } = build()
    await (await reranker).rerank(QUERY, CANDIDATES)
    expect(fake.pairs[0]?.texts).toEqual([QUERY, QUERY, QUERY])
    expect(fake.pairs[0]?.textPairs).toEqual(CANDIDATES.map((candidate) => candidate.text))
  })

  it('reorders by relevance, overruling the fusion score it arrived with', async () => {
    // c3 came in first from the fusion and is about combustion engines; the point of a
    // reranker is that it can say so.
    const ranked = await (await build().reranker).rerank(QUERY, CANDIDATES)
    expect(ranked.map((result) => result.id)).toEqual(['c2', 'c1', 'c3'])
  })

  it('returns scores in (0, 1), higher is better', async () => {
    const ranked = await (await build().reranker).rerank(QUERY, CANDIDATES)
    for (const result of ranked) {
      expect(result.score).toBeGreaterThan(0)
      expect(result.score).toBeLessThan(1)
    }
    expect(ranked[0]?.score).toBeGreaterThan(ranked[2]?.score as number)
  })

  it('keeps at most topN, and never invents an id', async () => {
    const ranked = await (await build().reranker).rerank(QUERY, CANDIDATES, { topN: 2 })
    expect(ranked.map((result) => result.id)).toEqual(['c2', 'c1'])
    const ids = new Set(CANDIDATES.map((candidate) => candidate.id))
    expect(ranked.every((result) => ids.has(result.id))).toBe(true)
  })

  it('batches, so 50 fused candidates are not one forward pass', async () => {
    const { fake, reranker } = build({ batchSize: 2 })
    await (await reranker).rerank(QUERY, CANDIDATES)
    expect(fake.pairs.map((pair) => pair.texts.length)).toEqual([2, 1])
  })

  it('is stable on ties, so two runs give the same order', async () => {
    const { fake, reranker } = build()
    fake.score = () => 1
    const ranked = await (await reranker).rerank(QUERY, CANDIDATES)
    expect(ranked.map((result) => result.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('does nothing for an empty candidate list', async () => {
    const { fake, reranker } = build()
    expect(await (await reranker).rerank(QUERY, [])).toEqual([])
    expect(fake.pairs).toEqual([])
  })

  it('falls back to CPU when the requested accelerator refuses', async () => {
    const fake = createFakeRerankerModule()
    fake.refuse.add('cuda')
    const reranker = await createTransformersReranker({
      spec: SPEC,
      modelsRoot: ROOT,
      device: 'cuda',
      loadModule: async () => fake,
      environment: { platform: 'linux', hasWebGpu: false, hasCudaProvider: true },
    })
    expect(reranker.device).toBe('cpu')
  })

  it('refuses to be built from an embedding entry', async () => {
    await expect(
      createTransformersReranker({
        spec: requireModel('embeddinggemma-300m'),
        modelsRoot: ROOT,
        loadModule: async () => createFakeRerankerModule(),
      }),
    ).rejects.toThrow(/is a embedding model, not a reranker/)
  })

  it('stops when cancelled mid-way through a long candidate list', async () => {
    const { reranker } = build({ batchSize: 1, signal: { aborted: true } })
    await expect((await reranker).rerank(QUERY, CANDIDATES)).rejects.toThrow(/cancelled/)
  })

  it('frees the session when disposed', async () => {
    const { fake, reranker } = build()
    await (await reranker).dispose()
    expect(fake.disposed).toBe(1)
  })
})

describe('the no-op reranker it replaces', () => {
  it('keeps the fusion order and the fusion scores untouched', async () => {
    // The default retrieval ships without a cross-encoder; this is what "reranker: none"
    // means, and it has to stay a true identity so the two paths are comparable.
    const ranked = await passthroughReranker.rerank(QUERY, CANDIDATES)
    expect(ranked).toEqual(CANDIDATES.map(({ id, score }) => ({ id, score })))
  })
})
