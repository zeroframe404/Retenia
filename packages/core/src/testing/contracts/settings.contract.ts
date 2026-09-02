import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SETTINGS_DEFAULTS } from '../../ports/settings-repository'
import type { ContractContext, RepositoryContractHarness } from '../harness'

/** Typed settings over an untyped table: defaults, upserts against the live-unique key
 *  index, and forward compatibility with keys a newer version wrote. */
export function settingsContract(harness: RepositoryContractHarness): void {
  describe('settings', () => {
    let ctx: ContractContext
    beforeEach(async () => {
      ctx = await harness.create()
    })
    afterEach(async () => {
      await ctx.dispose()
    })

    it('falls back to the registered default for a key never written', async () => {
      expect(await ctx.repos.settings.get('review.dailyNewLimit')).toBe(
        SETTINGS_DEFAULTS['review.dailyNewLimit'],
      )
      expect(await ctx.repos.settings.get('ui.theme')).toBe('system')
    })

    it('round-trips every value shape', async () => {
      await ctx.repos.settings.set('ui.soberMode', true)
      await ctx.repos.settings.set('review.dayStartHour', 6)
      await ctx.repos.settings.set('app.locale', 'en')
      await ctx.repos.settings.set('ai.providers.allowlist', ['anthropic', 'google'])

      expect(await ctx.repos.settings.get('ui.soberMode')).toBe(true)
      expect(await ctx.repos.settings.get('review.dayStartHour')).toBe(6)
      expect(await ctx.repos.settings.get('app.locale')).toBe('en')
      expect(await ctx.repos.settings.get('ai.providers.allowlist')).toEqual([
        'anthropic',
        'google',
      ])
    })

    it('updates the same live row rather than inserting a second one', async () => {
      await ctx.repos.settings.set('review.dayStartHour', 5)
      await ctx.repos.settings.set('review.dayStartHour', 7)
      // A second live row would violate the `settings_key_live` unique index.
      expect(await ctx.repos.settings.get('review.dayStartHour')).toBe(7)
      expect(await ctx.countRows('settings')).toBe(1)
    })

    it('returns the default again after unset, and can be set once more', async () => {
      await ctx.repos.settings.set('review.dayStartHour', 9)
      await ctx.repos.settings.unset('review.dayStartHour')
      expect(await ctx.repos.settings.get('review.dayStartHour')).toBe(
        SETTINGS_DEFAULTS['review.dayStartHour'],
      )

      // A soft-deleted key must not block a fresh live row.
      await ctx.repos.settings.set('review.dayStartHour', 11)
      expect(await ctx.repos.settings.get('review.dayStartHour')).toBe(11)
    })

    it('degrades to the default when the stored value is not readable', async () => {
      // What a downgrade sees after a newer version wrote a different shape.
      await ctx.repos.settings.setRaw('review.dayStartHour', 'six o clock')
      expect(await ctx.repos.settings.get('review.dayStartHour')).toBe(
        SETTINGS_DEFAULTS['review.dayStartHour'],
      )
    })

    it('rejects an out-of-range stored value the same way', async () => {
      await ctx.repos.settings.setRaw('review.dayStartHour', 99)
      expect(await ctx.repos.settings.get('review.dayStartHour')).toBe(
        SETTINGS_DEFAULTS['review.dayStartHour'],
      )
    })

    it('preserves keys outside the registry instead of pruning them', async () => {
      // A downgrade must not destroy the settings a newer version relies on.
      await ctx.repos.settings.setRaw('feature.somethingNew', { enabled: true })
      await ctx.repos.settings.set('ui.soberMode', true)

      expect(await ctx.repos.settings.getRaw('feature.somethingNew')).toEqual({ enabled: true })
      expect(await ctx.repos.settings.all()).toMatchObject({
        'feature.somethingNew': { enabled: true },
        'ui.soberMode': true,
      })
    })

    it('reports only the registered keys that are actually stored', async () => {
      await ctx.repos.settings.set('ui.soberMode', true)
      await ctx.repos.settings.setRaw('feature.somethingNew', 1)

      const stored = await ctx.repos.settings.getStored()
      expect(stored).toEqual({ 'ui.soberMode': true })
    })

    it('returns undefined for an unknown key rather than a default', async () => {
      expect(await ctx.repos.settings.getRaw('never.written')).toBeUndefined()
    })
  })
}
