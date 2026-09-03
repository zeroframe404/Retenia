import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IMPORTANCE_LEVELS } from '../../entities'
import { createImportanceCatalog, DEFAULT_IMPORTANCE_LEVELS } from '../../memory/importance'
import type { ContractContext, RepositoryContractHarness } from '../harness'

/**
 * The five `importance_levels` rows (`docs/spec/02-memory-system.md` §7).
 *
 * They are seeded, not created: the suite proves the adapter ships them with the spec's
 * numbers and lets the user tune the knobs, rather than proving it can insert a sixth.
 */
export function importanceLevelsContract(harness: RepositoryContractHarness): void {
  describe('importance levels', () => {
    let ctx: ContractContext
    beforeEach(async () => {
      ctx = await harness.create()
    })
    afterEach(async () => {
      await ctx.dispose()
    })

    it('ships the five levels, review order first', async () => {
      const levels = await ctx.repos.importanceLevels.listOrdered()
      expect(levels.map((level) => level.name)).toEqual([
        'urgent',
        'high',
        'normal',
        'maintenance',
        'paused',
      ])
      expect(levels.map((level) => level.orderRank)).toEqual([1, 2, 3, 4, 5])
    })

    /**
     * The acceptance criterion, from the storage side: what the adapter seeds is exactly
     * what `packages/core` compiles in. `DEFAULT_IMPORTANCE_LEVELS` is the copy the
     * scheduler runs on when there is no database, so the two drifting apart would mean the
     * app schedules differently before and after its first read.
     */
    it('seeds the numbers of §7, matching the catalog core falls back to', async () => {
      const levels = await ctx.repos.importanceLevels.listOrdered()
      for (const level of levels) {
        expect({
          desiredRetention: level.desiredRetention,
          maxIntervalDays: level.maxIntervalDays,
          orderRank: level.orderRank,
          postponeAllowed: level.postponeAllowed,
          newPerDay: level.newPerDay,
          leechThreshold: level.leechThreshold,
          leechAction: level.leechAction,
        }).toEqual(DEFAULT_IMPORTANCE_LEVELS[level.name])
      }

      // …and a catalog built from the stored rows is the default catalog.
      const stored = createImportanceCatalog(levels)
      for (const name of IMPORTANCE_LEVELS) {
        expect(stored.get(name)).toEqual(createImportanceCatalog().get(name))
      }
    })

    it('finds a level by its natural key', async () => {
      const normal = await ctx.repos.importanceLevels.findByName('normal')
      expect(normal).toMatchObject({ desiredRetention: 0.9, maxIntervalDays: 1825 })
      expect(await ctx.repos.importanceLevels.findByName('nope' as never)).toBeUndefined()
    })

    it('lets the user tune maintenance inside §7’s 0.80–0.85 band', async () => {
      ctx.clock.advance(1000)
      const updated = await ctx.repos.importanceLevels.updateByName('maintenance', {
        desiredRetention: 0.82,
      })
      expect(updated).toMatchObject({ name: 'maintenance', desiredRetention: 0.82, version: 2 })
      expect((await ctx.repos.importanceLevels.findByName('maintenance'))?.desiredRetention).toBe(
        0.82,
      )
    })

    it('tunes a level that stores no retention at all', async () => {
      const updated = await ctx.repos.importanceLevels.updateByName('paused', {
        leechThreshold: 4,
      })
      expect(updated).toMatchObject({ desiredRetention: null, leechThreshold: 4 })
    })

    it('refuses to tune a level that does not exist', async () => {
      await expect(
        ctx.repos.importanceLevels.updateByName('nope' as never, { newPerDay: 1 }),
      ).rejects.toThrow()
    })

    it('enqueues an outbox row for a tuned level, like every other syncable table', async () => {
      const synced = await harness.create({ outboxEnabled: true })
      try {
        await synced.repos.importanceLevels.updateByName('normal', { newPerDay: 12 })
        const rows = await synced.listOutbox()
        expect(
          rows.some((row) => row.tableName === 'importance_levels' && row.op === 'update'),
        ).toBe(true)
      } finally {
        await synced.dispose()
      }
    })

    it('rejects a retention the schema forbids', async () => {
      if (!ctx.capabilities.checkConstraints) return
      await expect(
        ctx.repos.importanceLevels.updateByName('normal', { desiredRetention: 0.2 }),
      ).rejects.toThrow()
    })
  })
}
