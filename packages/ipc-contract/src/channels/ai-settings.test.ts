import { describe, expect, it } from 'vitest'
import { contract } from '../index'
import {
  AI_CALL_STATUS_VALUES,
  PROVIDER_KIND_VALUES,
  PROVIDER_ROLE_VALUES,
  pricingOverlayEntrySchema,
  providerCardSchema,
} from './ai-settings'

describe('provider kind vocabulary', () => {
  /** Mirrors `PROVIDER_KINDS` in `packages/ai/src/profiles.ts` — this leaf package cannot
   *  import `@retenia/ai`, so this is the assertion that catches drift between the two. */
  it('matches the kinds packages/ai routes to', () => {
    expect([...PROVIDER_KIND_VALUES]).toEqual(['anthropic', 'google', 'openai-compatible'])
  })
})

describe('provider role vocabulary', () => {
  /** Mirrors `ProviderRole` in `packages/ai/src/provider-port.ts`. */
  it('matches the roles packages/ai resolves', () => {
    expect([...PROVIDER_ROLE_VALUES]).toEqual([
      'smart',
      'cheap',
      'judge',
      'vision',
      'audio',
      'embed',
      'local',
    ])
  })
})

describe('ai call status vocabulary', () => {
  /** Mirrors `AI_CALL_STATUSES` in `packages/core/src/entities/enums.ts`. */
  it('matches the two statuses the cost log records', () => {
    expect([...AI_CALL_STATUS_VALUES]).toEqual(['ok', 'error'])
  })
})

const card = {
  id: 'anthropic',
  kind: 'anthropic' as const,
  label: 'Anthropic',
  models: ['claude-sonnet-5'],
  perMillionUsd: { 'claude-sonnet-5': { input: 2, output: 10 } },
  local: false,
  hasKey: true,
  keyPreview: '••••wxyz',
  baseUrl: null,
}

describe('ai.listProviderCards', () => {
  it('never carries a key value, only presence and a masked preview', () => {
    const parsed = providerCardSchema.parse(card)
    expect(parsed).not.toHaveProperty('apiKey')
    expect(parsed.hasKey).toBe(true)
    expect(parsed.keyPreview).toBe('••••wxyz')
  })

  it('accepts a card with no price data for a model', () => {
    expect(
      providerCardSchema.safeParse({ ...card, perMillionUsd: { 'claude-sonnet-5': null } }).success,
    ).toBe(true)
  })
})

describe('ai.probeProvider', () => {
  const { input, output } = contract['ai.probeProvider']

  it('takes a profile id', () => {
    expect(input.parse({ profileId: 'anthropic' })).toEqual({ profileId: 'anthropic' })
  })

  it('answers ok, a model list, an error and a latency', () => {
    expect(
      output.safeParse({ ok: true, models: ['claude-sonnet-5'], error: null, latencyMs: 420 })
        .success,
    ).toBe(true)
    expect(
      output.safeParse({
        ok: false,
        models: [],
        error: 'the provider rejected the key',
        latencyMs: 12,
      }).success,
    ).toBe(true)
  })
})

describe('ai.setRoles', () => {
  const { input } = contract['ai.setRoles']

  it('accepts a role with no primary — "not assigned yet"', () => {
    expect(
      input.safeParse({ roles: [{ role: 'smart', primary: null, fallbacks: [] }] }).success,
    ).toBe(true)
  })

  it('rejects a role nobody has heard of', () => {
    expect(
      input.safeParse({
        roles: [{ role: 'not-a-role', primary: null, fallbacks: [] }],
      }).success,
    ).toBe(false)
  })
})

describe('pricingOverlayEntrySchema', () => {
  it('accepts an entry with every field left as "no edit" but the day set', () => {
    expect(
      pricingOverlayEntrySchema.safeParse({
        modelKey: 'anthropic:claude-sonnet-5',
        input: null,
        output: null,
        cacheRead: null,
        cacheWrite5m: null,
        cacheWrite1h: null,
        batchDiscount: null,
        asOf: '2026-09-08',
      }).success,
    ).toBe(true)
  })

  it('refuses a negative rate', () => {
    expect(
      pricingOverlayEntrySchema.safeParse({
        modelKey: 'anthropic:claude-sonnet-5',
        input: -1,
        output: null,
        cacheRead: null,
        cacheWrite5m: null,
        cacheWrite1h: null,
        batchDiscount: null,
        asOf: '2026-09-08',
      }).success,
    ).toBe(false)
  })
})

describe('ai.exportUsageCsv', () => {
  const { input, output } = contract['ai.exportUsageCsv']

  it('takes a month and answers where it was saved, or null on cancel', () => {
    expect(input.parse({ month: '2026-09' })).toEqual({ month: '2026-09' })
    expect(output.parse({ savedTo: null })).toEqual({ savedTo: null })
  })

  it('refuses a malformed month', () => {
    expect(input.safeParse({ month: 'September' }).success).toBe(false)
  })
})
