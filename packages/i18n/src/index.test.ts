import { describe, expect, it } from 'vitest'
import { defaultLocale, fallbackLocale, resources } from './index'

describe('@retenia/i18n', () => {
  it('defaults to es-AR with en as the fallback', () => {
    expect(defaultLocale).toBe('es-AR')
    expect(fallbackLocale).toBe('en')
  })

  it('has a common namespace with an appTitle and greeting for both locales', () => {
    for (const locale of [defaultLocale, fallbackLocale] as const) {
      expect(resources[locale].common.appTitle).toBe('Retenia')
      expect(typeof resources[locale].common.greeting).toBe('string')
      expect(resources[locale].common.greeting.length).toBeGreaterThan(0)
    }
  })
})
