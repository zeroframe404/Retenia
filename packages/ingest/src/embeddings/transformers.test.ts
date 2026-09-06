import { describe, expect, it } from 'vitest'
import { createFakeTransformers } from '../../test/fake-transformers'
import { requireModel } from '../models/catalog'
import { createTransformersEmbedding, defaultBatchSize } from './transformers'

const GEMMA = requireModel('embeddinggemma-300m')
const BGE = requireModel('bge-m3')
const ROOT = '/models'

function norm(vector: Float32Array): number {
  let sum = 0
  for (const value of vector) sum += value * value
  return Math.sqrt(sum)
}

const build = (spec = GEMMA, overrides: Record<string, unknown> = {}) => {
  const fake = createFakeTransformers(spec)
  return {
    fake,
    provider: createTransformersEmbedding({
      spec,
      modelsRoot: ROOT,
      loadModule: async () => fake,
      environment: { platform: 'linux', hasWebGpu: false, hasCudaProvider: false },
      ...overrides,
    }),
  }
}

describe('createTransformersEmbedding', () => {
  it('loads the model from disk only, never from the network', async () => {
    const { fake, provider } = build()
    await provider
    // The fake throws if `allowRemoteModels` is still on when the pipeline is built, so this
    // is enforced, not just asserted after the fact.
    expect(fake.env.allowRemoteModels).toBe(false)
    expect(fake.env.localModelPath).toBe(ROOT)
    expect(fake.loads[0]).toMatchObject({
      task: 'feature-extraction',
      model: GEMMA.repo,
      options: { dtype: GEMMA.dtype, local_files_only: true },
    })
  })

  it('names the space, not the model, so a reduced model is never mixed with its own output', async () => {
    const gemma = await build().provider
    const bge = await build(BGE).provider
    expect(gemma.modelId).toBe(GEMMA.spaceId)
    expect(bge.modelId).toBe(BGE.spaceId)
    expect(gemma.modelId).not.toBe(bge.modelId)
  })

  it('returns one unit vector of the index width per text, in order', async () => {
    const provider = await build().provider
    const texts = ['la sangre circula', 'the heart pumps blood', 'la sangre circula']
    const vectors = await provider.embed(texts)

    expect(vectors).toHaveLength(3)
    for (const vector of vectors) {
      expect(vector).toHaveLength(GEMMA.dims)
      expect(norm(vector)).toBeCloseTo(1, 5)
    }
    // Same text in and out of order gives the same vector: the batch is not reshuffled.
    expect([...(vectors[0] as Float32Array)]).toEqual([...(vectors[2] as Float32Array)])
    expect([...(vectors[0] as Float32Array)]).not.toEqual([...(vectors[1] as Float32Array)])
  })

  it('reduces bge-m3 from its native 1024 to the index width', async () => {
    const provider = await build(BGE).provider
    expect(provider.dims).toBe(BGE.dims)
    const [vector] = await provider.embed(['mitocondrias'])
    expect(vector).toHaveLength(768)
    expect(norm(vector as Float32Array)).toBeCloseTo(1, 5)
  })

  it('applies the document prefix to passages and the query prefix to a query', async () => {
    const { fake, provider: pending } = build()
    const provider = await pending
    await provider.embed(['la sangre'])
    await provider.embedQuery?.('la sangre')

    expect(fake.batches[0]).toEqual([`${GEMMA.documentPrefix}la sangre`])
    expect(fake.batches[1]).toEqual([`${GEMMA.queryPrefix}la sangre`])
    // And they really are different strings — a symmetric call would be a silent recall loss.
    expect(fake.batches[0]).not.toEqual(fake.batches[1])
  })

  it('pools the way the catalog says and normalizes itself, not in the pipeline', async () => {
    // The pipeline would normalize at the model's *native* width; for a reduced model that
    // vector is no longer unit-length after truncation or projection.
    const { fake, provider } = build(BGE)
    await (await provider).embed(['x'])
    expect(fake.callOptions[0]).toEqual({ pooling: BGE.pooling, normalize: false })
  })

  it('splits a long list into batches of the configured size', async () => {
    const { fake, provider } = build(GEMMA, { batchSize: 2 })
    const texts = Array.from({ length: 5 }, (_unused, index) => `chunk ${index}`)
    const vectors = await (await provider).embed(texts)

    expect(vectors).toHaveLength(5)
    expect(fake.batches.map((batch) => batch.length)).toEqual([2, 2, 1])
  })

  it('reports batch progress so a 300-page book has a moving bar', async () => {
    const seen: [number, number][] = []
    const { provider } = build(GEMMA, {
      batchSize: 2,
      onBatch: (done: number, total: number) => seen.push([done, total]),
    })
    await (await provider).embed(['a', 'b', 'c'])
    expect(seen).toEqual([
      [2, 3],
      [3, 3],
    ])
  })

  it('does nothing at all for an empty batch', async () => {
    const { fake, provider } = build()
    expect(await (await provider).embed([])).toEqual([])
    expect(fake.batches).toEqual([])
  })

  it('falls back through the devices and reports the one that took it', async () => {
    const devices: string[] = []
    const fake = createFakeTransformers(GEMMA)
    fake.refuse.add('cuda')
    const provider = await createTransformersEmbedding({
      spec: GEMMA,
      modelsRoot: ROOT,
      device: 'cuda',
      loadModule: async () => fake,
      environment: { platform: 'linux', hasWebGpu: false, hasCudaProvider: true },
      onDevice: (device) => devices.push(device),
    })
    expect(fake.loads.map((load) => load.options.device)).toEqual(['cuda', 'cpu'])
    expect(provider.device).toBe('cpu')
    expect(devices).toEqual(['cpu'])
  })

  it('reports every failure when no device works, rather than the last one alone', async () => {
    const fake = createFakeTransformers(GEMMA)
    fake.refuse.add('cpu')
    await expect(
      createTransformersEmbedding({
        spec: GEMMA,
        modelsRoot: ROOT,
        loadModule: async () => fake,
        environment: { platform: 'linux', hasWebGpu: false, hasCudaProvider: false },
      }),
    ).rejects.toThrow(/Could not load embeddinggemma-300m.*cpu: no cpu execution provider/s)
  })

  it('picks a batch size per device: narrow on CPU, wide on an accelerator', async () => {
    expect(defaultBatchSize('cpu')).toBeLessThan(defaultBatchSize('cuda'))
    const provider = await build().provider
    expect(provider.batchSize).toBe(defaultBatchSize('cpu'))
  })

  it('refuses to be built from a reranker entry', async () => {
    const reranker = requireModel('bge-reranker-v2-m3')
    await expect(
      createTransformersEmbedding({
        spec: reranker,
        modelsRoot: ROOT,
        loadModule: async () => createFakeTransformers(reranker),
      }),
    ).rejects.toThrow(/is a reranker model/)
  })

  it('stops when the signal is aborted rather than embedding the rest of the book', async () => {
    const { provider } = build(GEMMA, { batchSize: 1, signal: { aborted: true } })
    await expect((await provider).embed(['a', 'b'])).rejects.toThrow(/cancelled/)
  })

  it('frees the session when disposed', async () => {
    const { fake, provider } = build()
    await (await provider).dispose()
    expect(fake.disposed).toBe(1)
  })
})
