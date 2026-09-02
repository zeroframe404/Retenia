import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ContractContext, RepositoryContractHarness } from '../harness'

/** Retrieval over chunks: full text, vectors, and the RRF fusion of the two
 *  (`docs/spec/05-ingestion-rag.md` §4). The reranker on top is sub-phase 3.3. */
export function chunksContract(harness: RepositoryContractHarness): void {
  describe('chunk search', () => {
    let ctx: ContractContext
    beforeEach(async () => {
      ctx = await harness.create()
    })
    afterEach(async () => {
      await ctx.dispose()
    })

    it('finds a chunk by its text', async () => {
      const chunk = await ctx.seed.chunk({ text: 'El corazón bombea sangre al cuerpo' })
      await ctx.seed.chunk({ text: 'La glucólisis ocurre en el citoplasma' })

      const hits = await ctx.repos.chunks.search('corazón', { mode: 'fts' })
      expect(hits.map((hit) => hit.chunk.id)).toEqual([chunk.id])
    })

    it('matches without diacritics, as the tokenizer promises', async () => {
      await ctx.seed.chunk({ text: 'El corazón bombea sangre' })
      const hits = await ctx.repos.chunks.search('corazon', { mode: 'fts' })
      expect(hits).toHaveLength(1)
    })

    it('returns a snippet marking the hit', async () => {
      await ctx.seed.chunk({ text: 'El corazón bombea sangre al cuerpo' })
      const [hit] = await ctx.repos.chunks.search('corazón', { mode: 'fts' })
      expect(hit?.snippet).toContain('<b>')
    })

    it('treats the query as text, never as index syntax', async () => {
      await ctx.seed.chunk({ text: 'El corazón bombea sangre' })
      // Operators in user input must not be parsed — this would be a syntax error if it were.
      await expect(ctx.repos.chunks.search('corazón OR (', { mode: 'fts' })).resolves.toBeDefined()
    })

    it('returns nothing for an empty query', async () => {
      await ctx.seed.chunk({ text: 'El corazón bombea sangre' })
      expect(await ctx.repos.chunks.search('   ', { mode: 'fts' })).toEqual([])
    })

    it('never returns a soft-deleted chunk', async () => {
      const chunk = await ctx.seed.chunk({ text: 'El corazón bombea sangre' })
      await ctx.repos.chunks.softDelete(chunk.id)
      expect(await ctx.repos.chunks.search('corazón', { mode: 'fts' })).toEqual([])
    })

    it('never returns a chunk whose source was soft-deleted', async () => {
      // The cascade in migration 0001 takes the chunk out of the index with the source.
      const source = await ctx.seed.source()
      await ctx.seed.chunk({ sourceId: source.id, text: 'El corazón bombea sangre' })
      await ctx.repos.sources.softDelete(source.id)
      expect(await ctx.repos.chunks.search('corazón', { mode: 'fts' })).toEqual([])
    })

    it('finds a chunk again after its source is restored', async () => {
      const source = await ctx.seed.source()
      await ctx.seed.chunk({ sourceId: source.id, text: 'El corazón bombea sangre' })
      await ctx.repos.sources.softDelete(source.id)
      await ctx.repos.sources.restore(source.id)
      expect(await ctx.repos.chunks.search('corazón', { mode: 'fts' })).toHaveLength(1)
    })

    it('restricts to one source when asked', async () => {
      const wanted = await ctx.seed.source({ title: 'Fisiología' })
      const other = await ctx.seed.source({ title: 'Bioquímica' })
      const chunk = await ctx.seed.chunk({ sourceId: wanted.id, text: 'sangre y corazón' })
      await ctx.seed.chunk({ sourceId: other.id, text: 'sangre y glucosa' })

      const hits = await ctx.repos.chunks.search('sangre', { mode: 'fts', sourceId: wanted.id })
      expect(hits.map((hit) => hit.chunk.id)).toEqual([chunk.id])
      expect(chunk.id).not.toBe(other.id)
    })

    it('honours k', async () => {
      await ctx.seed.chunk({ text: 'sangre uno' })
      await ctx.seed.chunk({ text: 'sangre dos' })
      await ctx.seed.chunk({ text: 'sangre tres' })
      expect(await ctx.repos.chunks.search('sangre', { mode: 'fts', k: 2 })).toHaveLength(2)
    })

    it('lists a source chunks in ordinal order', async () => {
      const source = await ctx.seed.source()
      await ctx.seed.chunk({ sourceId: source.id, ordinal: 2, text: 'tres' })
      await ctx.seed.chunk({ sourceId: source.id, ordinal: 0, text: 'uno' })
      await ctx.seed.chunk({ sourceId: source.id, ordinal: 1, text: 'dos' })

      const listed = await ctx.repos.chunks.listBySource(source.id)
      expect(listed.map((chunk) => chunk.ordinal)).toEqual([0, 1, 2])
    })

    it('finds re-ingested chunks by content hash', async () => {
      const chunk = await ctx.seed.chunk({ text: 'idéntico' })
      const found = await ctx.repos.chunks.findByHash(chunk.hash)
      expect(found.map((entry) => entry.id)).toContain(chunk.id)
    })
  })
}
