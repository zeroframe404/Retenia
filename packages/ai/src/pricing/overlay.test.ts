import { describe, expect, it } from 'vitest'
import { FIXTURE_TABLE, makePricingTable } from '../testing'
import { mergePricingOverlay, pricingOverlaySchema, unknownOverlayKeys } from './overlay'
import { resolveRates } from './table'

const AT = new Date('2026-09-08T12:00:00Z')

describe('mergePricingOverlay', () => {
  it('is an identity for an empty overlay — what "Restaurar" resets to', () => {
    expect(mergePricingOverlay(FIXTURE_TABLE, {})).toBe(FIXTURE_TABLE)
  })

  it('produces the same resolveRates output as setting overrides directly', () => {
    const overlay = pricingOverlaySchema.parse({
      'fixture:base': {
        input: 9,
        output: null,
        cacheRead: null,
        cacheWrite5m: null,
        cacheWrite1h: null,
        batchDiscount: null,
        asOf: '2026-09-08',
      },
    })

    const merged = mergePricingOverlay(FIXTURE_TABLE, overlay)
    const manual = makePricingTable({
      'fixture:base': { overrides: { input: 9 } },
    })

    expect(resolveRates(merged, 'fixture:base', AT)).toEqual(
      resolveRates(manual, 'fixture:base', AT),
    )
  })

  it('null fields leave the shipped rate untouched, only edited fields change', () => {
    const before = resolveRates(FIXTURE_TABLE, 'fixture:base', AT)
    const overlay = pricingOverlaySchema.parse({
      'fixture:base': {
        input: null,
        output: 42,
        cacheRead: null,
        cacheWrite5m: null,
        cacheWrite1h: null,
        batchDiscount: null,
        asOf: '2026-09-08',
      },
    })

    const after = resolveRates(mergePricingOverlay(FIXTURE_TABLE, overlay), 'fixture:base', AT)
    expect(after.input).toBe(before.input)
    expect(after.output).toBe(42)
  })

  it('skips a model key the base table does not know, rather than throwing', () => {
    const overlay = pricingOverlaySchema.parse({
      'nonexistent:model': {
        input: 1,
        output: 1,
        cacheRead: null,
        cacheWrite5m: null,
        cacheWrite1h: null,
        batchDiscount: null,
        asOf: '2026-09-08',
      },
    })

    expect(() => mergePricingOverlay(FIXTURE_TABLE, overlay)).not.toThrow()
    expect(mergePricingOverlay(FIXTURE_TABLE, overlay).models['nonexistent:model']).toBeUndefined()
  })
})

describe('unknownOverlayKeys', () => {
  it('names every overlay key the base table does not have', () => {
    const overlay = pricingOverlaySchema.parse({
      'fixture:base': {
        input: 1,
        output: 1,
        cacheRead: null,
        cacheWrite5m: null,
        cacheWrite1h: null,
        batchDiscount: null,
        asOf: '2026-09-08',
      },
      'ghost:model': {
        input: 1,
        output: 1,
        cacheRead: null,
        cacheWrite5m: null,
        cacheWrite1h: null,
        batchDiscount: null,
        asOf: '2026-09-08',
      },
    })

    expect(unknownOverlayKeys(FIXTURE_TABLE, overlay)).toEqual(['ghost:model'])
  })

  it('is empty when every overlay key resolves', () => {
    const overlay = pricingOverlaySchema.parse({
      'fixture:base': {
        input: 1,
        output: 1,
        cacheRead: null,
        cacheWrite5m: null,
        cacheWrite1h: null,
        batchDiscount: null,
        asOf: '2026-09-08',
      },
    })

    expect(unknownOverlayKeys(FIXTURE_TABLE, overlay)).toEqual([])
  })
})
