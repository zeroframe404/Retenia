import type { Chunk, EmbeddingProvider, Reranker } from '@retenia/core'
import { passthroughReranker } from '@retenia/core'
import { createFakeEmbeddingProvider } from '@retenia/core/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHybridSearch, type HybridSearch, RRF_K, type VectorIndex } from './hybrid-search'
import type { OpenedDatabase } from './open-database'
import { createRepositories } from './repositories'
import { paths } from './schema'
import { embedSeededSource, type SeedChunk, seedSourceWithChunks } from './test-fixtures'
import { audit, openTestDatabase, testClock, testIds } from './testing'

/**
 * Hybrid retrieval over a small Spanish corpus: accents, stopwords and the natural-language
 * questions a user actually types (`docs/spec/05-ingestion-rag.md` §4).
 *
 * The corpus is deliberately written the way source material is — full sentences with
 * articles and prepositions — because that is what makes the two branches disagree, which is
 * the whole reason the search is hybrid.
 */

const CORPUS = [
  {
    text: 'El corazón bombea la sangre oxigenada hacia todo el cuerpo a través de la aorta.',
    headingPath: 'Fisiología > Sistema circulatorio',
    locator: { page: 112, block_ids: ['b-112-1', 'b-112-2'] },
  },
  {
    text: 'Las mitocondrias producen ATP mediante la fosforilación oxidativa de la célula.',
    headingPath: 'Bioquímica > Metabolismo celular',
    locator: { page: 240, block_ids: ['b-240-1'] },
  },
  {
    text: 'La neurona transmite el impulso nervioso por el axón hasta la sinapsis química.',
    headingPath: 'Neurociencia > Transmisión del impulso',
    locator: { page: 318, block_ids: [] },
  },
  {
    text: 'El músculo cardíaco se contrae de forma rítmica gracias al nódulo sinoauricular.',
    headingPath: 'Fisiología > Sistema circulatorio',
    locator: { page: 118, block_ids: ['b-118-1'] },
  },
  {
    text: 'La glucólisis degrada la glucosa en piruvato dentro del citoplasma de la célula.',
    headingPath: 'Bioquímica > Metabolismo celular',
    locator: { page: 244, block_ids: ['b-244-1'] },
  },
] satisfies SeedChunk[]

describe('hybrid search (BM25 ∪ vector → RRF → reranker)', () => {
  let opened: OpenedDatabase
  let sourceId: string
  let chunkIds: string[]
  let repos: ReturnType<typeof createRepositories>
  const clock = testClock()
  const ids = testIds(clock)
  const provider: EmbeddingProvider = createFakeEmbeddingProvider()

  /** `search` bound to the fake model, so every test does not repeat the vector plumbing. */
  async function hybridSearch(
    query: string,
    options: Record<string, unknown> = {},
  ): Promise<{ id: string; sourceId: string; text: string }[]> {
    const embedding = (await provider.embed([query]))[0] as Float32Array
    const hits = await repos.chunks.search(query, {
      mode: 'hybrid',
      embedding,
      modelId: provider.modelId,
      ...options,
    })
    return hits.map((hit) => ({
      id: hit.chunk.id,
      sourceId: hit.chunk.sourceId,
      text: hit.chunk.text,
    }))
  }

  beforeEach(async () => {
    opened = openTestDatabase()
    repos = createRepositories(opened, { deviceId: 'test-device', clock, ids })
    const seeded = seedSourceWithChunks(opened, ids, clock.nowMs(), CORPUS)
    sourceId = seeded.sourceId
    chunkIds = seeded.chunkIds
    await embedSeededSource(opened, ids, provider, seeded)
  })
  afterEach(() => opened.close())

  describe('Spanish text', () => {
    it('finds the accented chunk from an unaccented query, and the other way round', async () => {
      expect((await hybridSearch('corazon'))[0]?.id).toBe(chunkIds[0])
      expect((await hybridSearch('corazón'))[0]?.id).toBe(chunkIds[0])
      expect((await hybridSearch('fosforilacion'))[0]?.id).toBe(chunkIds[1])
      expect((await hybridSearch('glucólisis'))[0]?.id).toBe(chunkIds[4])
    })

    it('answers a natural-language question the BM25 branch alone cannot', async () => {
      // Every word is ANDed, and "cómo" and "funciona" are in no chunk, so full text finds
      // nothing at all. The vector branch carries the query — this is why search is hybrid.
      const question = '¿Cómo funciona el corazón al bombear la sangre?'
      const embedding = (await provider.embed([question]))[0] as Float32Array

      expect(await repos.chunks.search(question, { mode: 'fts' })).toEqual([])

      const hybrid = await repos.chunks.search(question, {
        mode: 'hybrid',
        embedding,
        modelId: provider.modelId,
      })
      expect(hybrid[0]?.chunk.id).toBe(chunkIds[0])
      expect(hybrid[0]?.vector).toBeDefined()
      expect(hybrid[0]?.fts).toBeUndefined()
    })

    it('survives a query made only of stopwords', async () => {
      // "de la el" is in nearly every chunk and carries no information. It must still run
      // (no parse error, no empty crash) rather than be special-cased away.
      expect((await hybridSearch('de la el')).length).toBeGreaterThan(0)
    })

    it('shows why the vector branch is needed: FTS5 keeps stopwords and ANDs them', async () => {
      // The tokenizer has no stopword list, so every function word the user types *narrows*
      // BM25. "de" is absent from the axon sentence, so the whole BM25 branch goes empty —
      // and the vector branch is what still answers the question.
      expect(await repos.chunks.search('el axón de la sinapsis', { mode: 'fts' })).toEqual([])
      expect(
        (await repos.chunks.search('el axón la sinapsis', { mode: 'fts' })).map(
          (hit) => hit.chunk.id,
        ),
      ).toEqual([chunkIds[2]])

      const hybrid = await hybridSearch('el axón de la sinapsis')
      expect(hybrid.map((hit) => hit.id)).toContain(chunkIds[2])
    })

    it('treats punctuation and index operators as text, never as syntax', async () => {
      await expect(hybridSearch('corazón OR NOT (sangre')).resolves.toBeDefined()
      await expect(hybridSearch('¿la célula?')).resolves.toBeDefined()
      await expect(hybridSearch('"comilla sin cerrar')).resolves.toBeDefined()
    })

    it('supports quoted phrases and type-ahead prefixes', async () => {
      const phrase = await repos.chunks.search('"impulso nervioso"', { mode: 'fts' })
      expect(phrase.map((hit) => hit.chunk.id)).toEqual([chunkIds[2]])

      // The two words apart appear in no chunk in that order, so the phrase must not match.
      expect(await repos.chunks.search('"nervioso impulso"', { mode: 'fts' })).toEqual([])

      const prefix = await repos.chunks.search('mitoc', { mode: 'fts', prefix: true })
      expect(prefix.map((hit) => hit.chunk.id)).toEqual([chunkIds[1]])
      expect(await repos.chunks.search('mitoc', { mode: 'fts' })).toEqual([])
    })
  })

  describe('fusion', () => {
    it('ranks a chunk both branches agree on above one only a single branch found', async () => {
      const hits = await repos.chunks.search('mitocondrias', {
        mode: 'hybrid',
        embedding: (await provider.embed(['mitocondrias']))[0] as Float32Array,
        modelId: provider.modelId,
      })
      const top = hits[0]
      expect(top?.chunk.id).toBe(chunkIds[1])
      expect(top?.fts).toBeDefined()
      expect(top?.vector).toBeDefined()
      // Both branches at rank 1 is the maximum RRF score there is.
      expect(top?.score).toBeCloseTo(2 / (RRF_K + 1), 12)
      expect(hits[1]?.score).toBeLessThan(top?.score as number)
    })

    it('reports each branch rank and its raw measure alongside the fused score', async () => {
      const [hit] = await hybridSearch('mitocondrias')
      const hits = await repos.chunks.search('mitocondrias', {
        mode: 'hybrid',
        embedding: (await provider.embed(['mitocondrias']))[0] as Float32Array,
        modelId: provider.modelId,
      })
      expect(hit?.id).toBe(chunkIds[1])
      expect(hits[0]?.fts?.rank).toBe(1)
      expect(hits[0]?.fts?.bm25).toBeLessThan(0)
      expect(hits[0]?.vector?.rank).toBe(1)
      expect(hits[0]?.vector?.distance).toBeGreaterThanOrEqual(0)
      expect(hits[0]?.fusionScore).toBe(hits[0]?.score)
    })

    it('honours k and returns nothing for a non-positive one', async () => {
      expect(await hybridSearch('célula', { k: 2 })).toHaveLength(2)
      expect(await hybridSearch('célula', { k: 0 })).toEqual([])
    })
  })

  describe('citations', () => {
    it('carries the page and the block ids of the chunk it returns', async () => {
      const hits = await repos.chunks.search('aorta', { mode: 'fts' })
      expect(hits[0]?.sourceLocator.page).toBe(112)
      expect(hits[0]?.blockIds).toEqual(['b-112-1', 'b-112-2'])
      expect(hits[0]?.sourceLocator.blockIds).toEqual(['b-112-1', 'b-112-2'])
    })

    it('returns an empty block list rather than undefined when the chunk has none', async () => {
      const hits = await repos.chunks.search('sinapsis', { mode: 'fts' })
      expect(hits[0]?.blockIds).toEqual([])
      expect(hits[0]?.sourceLocator.page).toBe(318)
    })

    it('marks the hit in the snippet and in the heading path', async () => {
      const hits = await repos.chunks.search('circulatorio aorta', { mode: 'fts' })
      expect(hits[0]?.snippet).toContain('<b>aorta</b>')
      expect(hits[0]?.headingHighlight).toContain('<b>circulatorio</b>')
    })
  })

  describe('filters', () => {
    it('restricts to a set of sources', async () => {
      const other = seedSourceWithChunks(
        opened,
        ids,
        clock.nowMs(),
        ['La aorta es la arteria más grande del cuerpo.'],
        { title: 'Anatomía' },
      )
      await embedSeededSource(opened, ids, provider, other)

      // The vector branch has no relevance threshold — it always returns its k nearest — so
      // the filter is asserted on *which* sources come back, not on how many hits there are.
      const unfiltered = await hybridSearch('aorta')
      expect(new Set(unfiltered.map((hit) => hit.sourceId))).toEqual(
        new Set([sourceId, other.sourceId]),
      )

      const filtered = await hybridSearch('aorta', { sourceIds: [other.sourceId] })
      expect(filtered.map((hit) => hit.id)).toEqual(other.chunkIds)

      expect(await hybridSearch('aorta', { sourceIds: [] })).toEqual([])
    })

    it('restricts to the sources a path was generated from', async () => {
      const other = seedSourceWithChunks(
        opened,
        ids,
        clock.nowMs(),
        ['La aorta es la arteria más grande del cuerpo.'],
        { title: 'Anatomía' },
      )
      await embedSeededSource(opened, ids, provider, other)

      const pathId = ids.next()
      opened.db
        .insert(paths)
        .values({
          id: pathId,
          title: 'Circulación',
          language: 'es',
          sourceIds: [other.sourceId],
          ...audit(clock.nowMs()),
        })
        .run()

      expect((await hybridSearch('aorta', { pathId })).map((hit) => hit.id)).toEqual(other.chunkIds)
    })

    it('matches nothing — not everything — when the path has no sources or does not exist', async () => {
      const pathId = ids.next()
      opened.db
        .insert(paths)
        .values({
          id: pathId,
          title: 'Vacío',
          language: 'es',
          sourceIds: [],
          ...audit(clock.nowMs()),
        })
        .run()

      expect(await hybridSearch('aorta', { pathId })).toEqual([])
      expect(await hybridSearch('aorta', { pathId: ids.next() })).toEqual([])
    })

    it('intersects a path filter with an explicit source filter', async () => {
      const pathId = ids.next()
      opened.db
        .insert(paths)
        .values({
          id: pathId,
          title: 'Fisiología',
          language: 'es',
          sourceIds: [sourceId],
          ...audit(clock.nowMs()),
        })
        .run()

      const both = await hybridSearch('aorta', { pathId, sourceIds: [sourceId] })
      expect(both.length).toBeGreaterThan(0)
      expect(new Set(both.map((hit) => hit.sourceId))).toEqual(new Set([sourceId]))
      // Disjoint facets intersect to nothing rather than falling back to either one.
      expect(await hybridSearch('aorta', { pathId, sourceIds: [ids.next()] })).toEqual([])
    })
  })

  describe('the reranker hook', () => {
    /** Stands in for a cross-encoder: it simply prefers the shortest text. */
    const shortestFirst: Reranker = {
      id: 'test-shortest-first',
      rerank: (_query, documents, options) =>
        Promise.resolve(
          [...documents]
            .sort((left, right) => left.text.length - right.text.length)
            .slice(0, options?.topN ?? documents.length)
            .map((document, index) => ({ id: document.id, score: 1 - index / 100 })),
        ),
    }

    it('reorders the fused candidates and keeps the fusion score visible', async () => {
      const reranked = createRepositories(opened, {
        deviceId: 'test-device',
        clock,
        ids,
        reranker: shortestFirst,
      })
      const embedding = (await provider.embed(['célula']))[0] as Float32Array
      const options = { mode: 'hybrid', embedding, modelId: provider.modelId } as const

      const fused = await repos.chunks.search('célula', options)
      const withReranker = await reranked.chunks.search('célula', options)

      const shortest = [...fused].sort((a, b) => a.chunk.text.length - b.chunk.text.length)[0]
      expect(withReranker[0]?.chunk.id).toBe(shortest?.chunk.id)
      expect(withReranker[0]?.score).toBe(1)
      // The RRF score survives next to the reranker's, so "why is this here" stays answerable.
      expect(withReranker[0]?.fusionScore).toBeGreaterThan(0)
      expect(withReranker[0]?.fusionScore).not.toBe(withReranker[0]?.score)
    })

    it('leaves the fusion order untouched under the passthrough default', async () => {
      const withPassthrough = createRepositories(opened, {
        deviceId: 'test-device',
        clock,
        ids,
        reranker: passthroughReranker,
      })
      const embedding = (await provider.embed(['célula']))[0] as Float32Array
      const options = { mode: 'hybrid', embedding, modelId: provider.modelId } as const

      const fused = await repos.chunks.search('célula', options)
      const passed = await withPassthrough.chunks.search('célula', options)
      expect(passed.map((hit) => hit.chunk.id)).toEqual(fused.map((hit) => hit.chunk.id))
      expect(passed.map((hit) => hit.score)).toEqual(fused.map((hit) => hit.score))
    })

    it('drops results the reranker invents and honours the ones it discards', async () => {
      const liar: Reranker = {
        id: 'test-liar',
        rerank: (_query, documents) =>
          Promise.resolve([
            { id: 'not-a-chunk-id', score: 1 },
            { id: (documents[0] as { id: string }).id, score: 0.5 },
          ]),
      }
      const reranked = createRepositories(opened, {
        deviceId: 'test-device',
        clock,
        ids,
        reranker: liar,
      })
      const hits = await reranked.chunks.search('célula', {
        mode: 'hybrid',
        embedding: (await provider.embed(['célula']))[0] as Float32Array,
        modelId: provider.modelId,
      })
      expect(hits).toHaveLength(1)
      expect(hits[0]?.score).toBe(0.5)
    })
  })

  describe('the vector index port', () => {
    it('uses whatever implementation it is given, so LanceDB can replace sqlite-vec', async () => {
      // A stand-in with no SQLite in it at all: if the pipeline still fuses and hydrates,
      // nothing above the port knows where the vectors live.
      const fake: VectorIndex = {
        name: 'test-in-memory',
        knn: () =>
          Promise.resolve([
            { chunkId: chunkIds[3] as string, sourceId, distance: 0.1 },
            { chunkId: chunkIds[0] as string, sourceId, distance: 0.2 },
          ]),
      }
      const withFake = createRepositories(opened, {
        deviceId: 'test-device',
        clock,
        ids,
        vectorIndex: fake,
      })
      const hits = await withFake.chunks.search('nada-coincide-aqui', {
        mode: 'vector',
        embedding: (await provider.embed(['x']))[0] as Float32Array,
        modelId: provider.modelId,
      })
      expect(hits.map((hit) => hit.chunk.id)).toEqual([chunkIds[3], chunkIds[0]])
      expect(hits[0]?.vector?.distance).toBe(0.1)
    })
  })

  describe('the service on its own', () => {
    it('can be built over any chunk loader, without the repositories', async () => {
      const loaded: string[] = []
      const service: HybridSearch = createHybridSearch({
        sqlite: opened.sqlite,
        loadChunks: async (chunkIdsToLoad) => {
          loaded.push(...chunkIdsToLoad)
          const rows = await repos.chunks.findMany(chunkIdsToLoad)
          return rows as readonly Chunk[]
        },
      })
      const hits = await service.search('aorta', { mode: 'fts' })
      expect(hits.map((hit) => hit.chunk.id)).toEqual([chunkIds[0]])
      // One batched hydration, not one read per hit.
      expect(loaded).toEqual([chunkIds[0]])
    })
  })
})
