import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_FSRS_W } from '../../memory/parameters'
import { GLOBAL_SCHEDULER_SCOPE } from '../../ports/scheduler-profile-repository'
import type { ContractContext, RepositoryContractHarness } from '../harness'

/**
 * `scheduler_profiles` (`docs/spec/02-memory-system.md` §6, §14): the parameters the
 * scheduler runs on, and where an accepted optimization lands.
 */
export function schedulerProfilesContract(harness: RepositoryContractHarness): void {
  describe('scheduler profiles', () => {
    let ctx: ContractContext
    beforeEach(async () => {
      ctx = await harness.create()
    })
    afterEach(async () => {
      await ctx.dispose()
    })

    /**
     * The table ships empty and the global row is minted on first read, rather than seeded
     * by a migration: `DEFAULT_FSRS_W` in core is the single source of the 21 published
     * defaults, and a migration holding a second copy would go stale the day `ts-fsrs`
     * ships new ones.
     */
    it('mints the global profile from the published defaults on first read', async () => {
      expect(await ctx.repos.schedulerProfiles.findByScope(GLOBAL_SCHEDULER_SCOPE)).toBeUndefined()

      const profile = await ctx.repos.schedulerProfiles.ensure(GLOBAL_SCHEDULER_SCOPE)
      expect(profile.scope).toBe(GLOBAL_SCHEDULER_SCOPE)
      expect(profile.algorithm).toBe('fsrs6')
      expect(profile.w).toEqual([...DEFAULT_FSRS_W])
      expect(profile.decay).toBe(DEFAULT_FSRS_W[20])
      expect(profile.learningSteps).toEqual(['1m', '10m'])
      expect(profile.relearningSteps).toEqual(['10m'])
      expect(profile.maximumInterval).toBe(36_500)
      expect(profile.dayStartHour).toBe(4)
      // Never trained: this is what the settings screen shows as "no optimization yet".
      expect(profile.trainedAt).toBeNull()
      expect(profile.nReviews).toBeNull()
      expect(profile.logLoss).toBeNull()
      expect(profile.rmse).toBeNull()
    })

    it('is idempotent: a second ensure returns the same row', async () => {
      const first = await ctx.repos.schedulerProfiles.ensure(GLOBAL_SCHEDULER_SCOPE)
      const second = await ctx.repos.schedulerProfiles.ensure(GLOBAL_SCHEDULER_SCOPE)
      expect(second.id).toBe(first.id)
      expect(second.version).toBe(first.version)
      expect(await ctx.repos.schedulerProfiles.count()).toBe(1)
    })

    it('keeps scopes apart', async () => {
      const global = await ctx.repos.schedulerProfiles.ensure(GLOBAL_SCHEDULER_SCOPE)
      const domain = await ctx.repos.schedulerProfiles.ensure('domain:physiology')
      expect(domain.id).not.toBe(global.id)
      expect(await ctx.repos.schedulerProfiles.count()).toBe(2)
    })

    it('records a trained model', async () => {
      const trainedAt = new Date('2026-09-01T10:00:00.000Z')
      const w = DEFAULT_FSRS_W.map((value, index) => (index === 0 ? value * 2 : value))

      const saved = await ctx.repos.schedulerProfiles.saveTrained(GLOBAL_SCHEDULER_SCOPE, {
        w,
        decay: w[20] as number,
        trainedAt,
        nReviews: 5_000,
        logLoss: 0.3123,
        rmse: 0.0412,
      })

      expect(saved.w).toEqual(w)
      expect(saved.trainedAt).toEqual(trainedAt)
      expect(saved.nReviews).toBe(5_000)
      expect(saved.logLoss).toBeCloseTo(0.3123, 6)
      expect(saved.rmse).toBeCloseTo(0.0412, 6)

      const reread = await ctx.repos.schedulerProfiles.findByScope(GLOBAL_SCHEDULER_SCOPE)
      expect(reread?.w).toEqual(w)
      expect(reread?.version).toBe(saved.version)
    })

    it('saveTrained on a scope that has no row yet mints it first', async () => {
      const saved = await ctx.repos.schedulerProfiles.saveTrained('domain:anatomy', {
        w: [...DEFAULT_FSRS_W],
        decay: DEFAULT_FSRS_W[20] as number,
        trainedAt: new Date('2026-09-02T00:00:00.000Z'),
        nReviews: 800,
        logLoss: 0.34,
        rmse: 0.06,
      })
      expect(saved.scope).toBe('domain:anatomy')
      expect(saved.nReviews).toBe(800)
    })

    /** Soft delete only, like every other table (`00-conventions.md`). */
    it('soft-deletes and restores', async () => {
      const profile = await ctx.repos.schedulerProfiles.ensure(GLOBAL_SCHEDULER_SCOPE)
      await ctx.repos.schedulerProfiles.softDelete(profile.id)
      expect(await ctx.repos.schedulerProfiles.findByScope(GLOBAL_SCHEDULER_SCOPE)).toBeUndefined()
      await ctx.repos.schedulerProfiles.restore(profile.id)
      expect((await ctx.repos.schedulerProfiles.findByScope(GLOBAL_SCHEDULER_SCOPE))?.id).toBe(
        profile.id,
      )
    })
  })
}
