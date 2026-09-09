import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Extraction, NewEntity } from '../../index'
import type { ContractContext, RepositoryContractHarness } from '../harness'

/** A stored row, as the input that would recreate it. */
function toInput(row: Extraction): NewEntity<Extraction> {
  return {
    runId: row.runId,
    sourceId: row.sourceId,
    chunkId: row.chunkId,
    chunkKey: row.chunkKey,
    chunkHash: row.chunkHash,
    customId: row.customId,
    promptVersion: row.promptVersion,
    schemaVersion: row.schemaVersion,
    provider: row.provider,
    model: row.model,
    output: row.output,
    conceptCount: row.conceptCount,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedTokens: row.cachedTokens,
    costUsd: row.costUsd,
  }
}

/** The per-chunk extraction store of sub-phase 8.1: one live row per `custom_id`, found in
 *  any quantity, replaced on `put`, and never resurrected through its key once retired. */
export function extractionsContract(harness: RepositoryContractHarness): void {
  describe('extractions', () => {
    let ctx: ContractContext
    beforeEach(async () => {
      ctx = await harness.create()
    })
    afterEach(async () => {
      await ctx.dispose()
    })

    it('stores one row per custom id and finds them by key', async () => {
      const rows: Extraction[] = []
      for (let index = 0; index < 5; index += 1) {
        rows.push(await ctx.seed.extraction({ customId: `P1_extract_chunk-${index}` }))
      }

      const found = await ctx.repos.extractions.findByCustomIds(rows.map((row) => row.customId))
      expect(new Set(found.map((row) => row.customId))).toEqual(
        new Set(rows.map((row) => row.customId)),
      )
      expect(await ctx.repos.extractions.findByCustomIds([])).toEqual([])
      expect(await ctx.repos.extractions.findByCustomIds(['missing'])).toEqual([])
    })

    it('finds ids in a quantity no single statement could carry', async () => {
      const present = [
        await ctx.seed.extraction({ customId: 'present-1' }),
        await ctx.seed.extraction({ customId: 'present-2' }),
        await ctx.seed.extraction({ customId: 'present-3' }),
      ]
      const absent = Array.from({ length: 1_200 }, (_, index) => `absent-${index}`)

      const found = await ctx.repos.extractions.findByCustomIds([
        ...absent.slice(0, 600),
        ...present.map((row) => row.customId),
        ...absent.slice(600),
        // A repeated id is asked for once.
        'present-1',
      ])
      expect(found.map((row) => row.customId).sort()).toEqual([
        'present-1',
        'present-2',
        'present-3',
      ])
    })

    it('replaces the live row for a custom id on put', async () => {
      const first = await ctx.seed.extraction({ customId: 'P1_extract_chunk-abc' })

      const replaced = await ctx.repos.extractions.put({
        ...toInput(first),
        model: 'other-model',
        output: { concepts: [{ canonical: 'x' }] },
        conceptCount: 1,
      })

      expect(replaced.id).toBe(first.id)
      expect(replaced.model).toBe('other-model')
      expect(replaced.conceptCount).toBe(1)
      expect(replaced.version).toBe(first.version + 1)
      expect(await ctx.countRows('extractions')).toBe(1)
    })

    it('inserts on put when the custom id is new', async () => {
      const seeded = await ctx.seed.extraction({ customId: 'seeded' })
      const created = await ctx.repos.extractions.put({ ...toInput(seeded), customId: 'fresh' })
      expect(created.id).not.toBe(seeded.id)
      expect(await ctx.countRows('extractions')).toBe(2)
    })

    it('lists by chunk and by source', async () => {
      const chunk = await ctx.seed.chunk()
      const mine = await ctx.seed.extraction({
        chunkId: chunk.id,
        sourceId: chunk.sourceId,
        customId: 'mine',
      })
      await ctx.seed.extraction({ customId: 'elsewhere' })

      expect((await ctx.repos.extractions.listByChunkIds([chunk.id])).map((row) => row.id)).toEqual(
        [mine.id],
      )
      expect(await ctx.repos.extractions.listByChunkIds([])).toEqual([])
      expect(
        (await ctx.repos.extractions.listBySource(chunk.sourceId)).map((row) => row.id),
      ).toEqual([mine.id])
    })

    it('does not resurrect a retired row through its custom id', async () => {
      const row = await ctx.seed.extraction({ customId: 'gone' })
      await ctx.repos.extractions.softDelete(row.id)
      expect(await ctx.repos.extractions.findByCustomIds(['gone'])).toEqual([])

      // A soft-deleted key must not block a fresh live row (the unique index is partial).
      const again = await ctx.seed.extraction({ customId: 'gone' })
      expect(again.id).not.toBe(row.id)
      expect(await ctx.countRows('extractions')).toBe(2)
    })
  })
}
