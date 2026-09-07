import { describe, expect, it } from 'vitest'
import { AiError } from '../errors'
import { DEFAULT_PROFILES } from '../profiles'
import { DEFAULT_ROLES } from '../roles'
import { FIXTURE_TABLE, makePricingTable } from '../testing'
import raw from './pricing.json' with { type: 'json' }
import { inUtcWindow, pricingTableSchema, resolveRates, SHIPPED_PRICING } from './table'

/**
 * Rows the shipped table prices but no configured profile can reach yet.
 *
 * They are forward data for the sub-phase named beside each: 7.4 adds the provider kinds
 * that route to them. Listing them here is what keeps that deliberate — the consistency
 * test below refuses any *other* orphan, so a row added by accident still fails the build.
 */
const NOT_YET_ROUTABLE: Readonly<Record<string, string>> = {
  'openai:gpt-5.6-terra': '7.4 — the OpenAI provider kind',
  'openai:gpt-5.6-luna': '7.4 — the OpenAI provider kind',
  'deepseek:deepseek-v4-flash': '7.4 — DeepSeek via the openai-compatible kind',
  'openrouter:deepseek/deepseek-v4-flash': '7.4 — the OpenRouter aggregator',
}

const SEPTEMBER = new Date('2026-09-07T12:00:00Z')

describe('the shipped pricing table', () => {
  it('parses, and the schema drops nothing from the file', () => {
    const parsed = pricingTableSchema.parse(raw)
    expect(parsed).toEqual(raw)
  })

  it('prices Gemini 3.7 Flash at its 2026 tier — the acceptance case', () => {
    const rates = resolveRates(SHIPPED_PRICING, 'google:gemini-3.7-flash', SEPTEMBER)
    expect(rates.input).toBe(0.75)
    expect(rates.output).toBe(3.75)
    expect(rates.cacheRead).toBe(0.075)
  })

  it('flips to the 2027 tier from the same file, with no code change', () => {
    const before = resolveRates(
      SHIPPED_PRICING,
      'google:gemini-3.7-flash',
      new Date('2026-12-31T23:59:59Z'),
    )
    const after = resolveRates(
      SHIPPED_PRICING,
      'google:gemini-3.7-flash',
      new Date('2027-01-02T00:00:00Z'),
    )
    expect([before.input, before.output]).toEqual([0.75, 3.75])
    expect([after.input, after.output]).toEqual([1.5, 7.5])
    expect(after.periodFrom).toBe('2027-01-01')
  })

  it('tiles the timeline, so no instant can resolve to a silent zero', () => {
    for (const [key, model] of Object.entries(SHIPPED_PRICING.models)) {
      if (model.periods === undefined) continue
      expect(model.periods.length, key).toBeGreaterThanOrEqual(1)
      expect(model.periods[0]?.from, key).toBeNull()
      for (const [index, period] of model.periods.entries()) {
        if (index === 0) continue
        const previous = model.periods[index - 1]?.from ?? ''
        expect(period.from, key).not.toBeNull()
        expect(String(period.from) > previous, `${key} period ${index}`).toBe(true)
      }
    }
  })

  it('derives every Anthropic cache rate from §2, with Fable as the one exemption', () => {
    // The rule belongs in a test, not duplicated into data: that is what turns the spec's
    // §1-vs-§2 conflict on Fable into a visible exemption instead of a silent typo.
    const exempt = new Set(['anthropic:claude-fable-5-1'])
    for (const [key, model] of Object.entries(SHIPPED_PRICING.models)) {
      if (!key.startsWith('anthropic:')) continue
      for (const period of model.periods ?? []) {
        expect(period.cacheWrite5m, key).toBeCloseTo(period.input * 1.25, 10)
        expect(period.cacheWrite1h, key).toBeCloseTo(period.input * 2, 10)
        if (exempt.has(key)) continue
        expect(period.cacheRead, key).toBeCloseTo(period.input * 0.1, 10)
      }
    }
    // Fable follows §2's rule too; it is §1's printed 0.25 we depart from, and the row
    // records why. Asserting it here stops "exempt" drifting into "unchecked".
    const fable = SHIPPED_PRICING.models['anthropic:claude-fable-5-1']?.periods?.[0]
    expect(fable?.cacheRead).toBe(1)
    expect(fable?.note).toMatch(/section 1/i)
  })

  it('prices every model a default profile lists, and orphans nothing', () => {
    const listed = new Set(
      DEFAULT_PROFILES.flatMap((profile) => profile.models.map((m) => `${profile.kind}:${m}`)),
    )
    for (const key of listed) {
      expect(Object.hasOwn(SHIPPED_PRICING.models, key), `${key} has no price`).toBe(true)
    }
    for (const key of Object.keys(SHIPPED_PRICING.models)) {
      if (listed.has(key)) continue
      expect(NOT_YET_ROUTABLE[key], `${key} is priced but unreachable and unexplained`).toBeTypeOf(
        'string',
      )
    }
    // And the reverse, so the map cannot outlive the rows it excuses.
    for (const key of Object.keys(NOT_YET_ROUTABLE)) {
      expect(Object.hasOwn(SHIPPED_PRICING.models, key), `${key} is excused but absent`).toBe(true)
    }
  })

  it('routes every default role to a profile that lists the model', () => {
    const byId = new Map(DEFAULT_PROFILES.map((p) => [p.id, p]))
    for (const [role, config] of Object.entries(DEFAULT_ROLES)) {
      if (config === undefined) continue
      for (const ref of [config.primary, ...config.fallbacks]) {
        const profile = byId.get(ref.profileId)
        expect(profile, `${role} -> ${ref.profileId}`).toBeDefined()
        expect(profile?.models, `${role} -> ${ref.profileId}`).toContain(ref.modelId)
      }
    }
  })

  it('applies the DeepSeek off-peak window and inherits it through the OpenRouter alias', () => {
    const peak = resolveRates(SHIPPED_PRICING, 'deepseek:deepseek-v4-flash', SEPTEMBER)
    const offPeak = resolveRates(
      SHIPPED_PRICING,
      'deepseek:deepseek-v4-flash',
      new Date('2026-09-07T18:00:00Z'),
    )
    expect([peak.input, peak.windowId]).toEqual([0.44, null])
    expect([offPeak.input, offPeak.output, offPeak.windowId]).toEqual([0.22, 0.66, 'off-peak'])

    const viaRouter = resolveRates(
      SHIPPED_PRICING,
      'openrouter:deepseek/deepseek-v4-flash',
      SEPTEMBER,
    )
    expect(viaRouter.baseModelKey).toBe('deepseek:deepseek-v4-flash')
    expect(viaRouter.input).toBe(0.44)
    expect(viaRouter.aggregator).toBe('openrouter')
  })

  it('throws for an unknown key rather than answering zero', () => {
    expect(() => resolveRates(SHIPPED_PRICING, 'anthropic:not-a-model', SEPTEMBER)).toThrow(AiError)
    try {
      resolveRates(SHIPPED_PRICING, 'anthropic:not-a-model', SEPTEMBER)
    } catch (error) {
      expect((error as AiError).code).toBe('model_not_priced')
    }
  })
})

describe('the pricing schema', () => {
  it('refuses an untiled timeline', () => {
    expect(() =>
      pricingTableSchema.parse({
        ...raw,
        models: {
          'x:y': {
            provider: 'x',
            modelId: 'y',
            label: 'y',
            periods: [
              {
                from: '2026-01-01',
                input: 1,
                output: 2,
                cacheRead: null,
                cacheWrite5m: null,
                cacheWrite1h: null,
                batchDiscount: null,
              },
            ],
          },
        },
      }),
    ).toThrow()
  })

  it('refuses an alias chain and an undeclared aggregator', () => {
    const base = {
      provider: 'x',
      modelId: 'y',
      label: 'y',
      periods: [
        {
          from: null,
          input: 1,
          output: 2,
          cacheRead: null,
          cacheWrite5m: null,
          cacheWrite1h: null,
          batchDiscount: null,
        },
      ],
    }
    expect(() =>
      pricingTableSchema.parse({
        ...raw,
        models: {
          'x:y': base,
          'x:a': { ...base, periods: undefined, aliasOf: 'x:b' },
          'x:b': { ...base, periods: undefined, aliasOf: 'x:y' },
        },
      }),
    ).toThrow()
    expect(() =>
      pricingTableSchema.parse({
        ...raw,
        models: { 'x:y': { ...base, aggregator: 'nope' } },
      }),
    ).toThrow()
  })

  it('refuses an unknown field, so a misspelled rate cannot read as "absent"', () => {
    const broken = structuredClone(raw) as { models: Record<string, Record<string, unknown>> }
    const model = broken.models['anthropic:claude-sonnet-5']
    if (model !== undefined) model.cacheWrite5min = 2.5
    expect(() => pricingTableSchema.parse(broken)).toThrow()
  })
})

describe('inUtcWindow', () => {
  it('treats the start as inclusive and the end as exclusive', () => {
    expect(inUtcWindow(new Date('2026-09-07T09:00:00Z'), '09:00', '17:00')).toBe(true)
    expect(inUtcWindow(new Date('2026-09-07T17:00:00Z'), '09:00', '17:00')).toBe(false)
    expect(inUtcWindow(new Date('2026-09-07T16:59:00Z'), '09:00', '17:00')).toBe(true)
  })

  it('wraps midnight when the end is at or before the start', () => {
    const inside = ['2026-09-07T16:30:00Z', '2026-09-07T23:59:00Z', '2026-09-07T00:00:00Z']
    for (const iso of inside) expect(inUtcWindow(new Date(iso), '16:30', '00:30'), iso).toBe(true)
    for (const iso of ['2026-09-07T00:31:00Z', '2026-09-07T12:00:00Z']) {
      expect(inUtcWindow(new Date(iso), '16:30', '00:30'), iso).toBe(false)
    }
  })
})

describe('resolution against a fixture table', () => {
  it('overlays a window on its period', () => {
    const peak = resolveRates(FIXTURE_TABLE, 'fixture:windowed', new Date('2026-09-07T12:00:00Z'))
    const off = resolveRates(FIXTURE_TABLE, 'fixture:windowed', new Date('2026-09-07T18:00:00Z'))
    expect(peak.input).toBe(1)
    expect(off.input).toBe(0.5)
    // Rates the window does not mention are inherited, not reset.
    expect(off.cacheRead).toBe(0.1)
  })

  it('lets an alias override an inherited rate', () => {
    const table = makePricingTable(
      {
        'fixture:base': {},
        'listing:base': { aliasOf: 'fixture:base', overrides: { input: 9, cacheRead: null } },
      },
      {},
    )
    const rates = resolveRates(table, 'listing:base', new Date('2026-09-07T12:00:00Z'))
    expect(rates.input).toBe(9)
    expect(rates.output).toBe(4)
    // An override may legitimately set a rate to null; `??` alone would lose that.
    expect(rates.cacheRead).toBeNull()
  })
})
