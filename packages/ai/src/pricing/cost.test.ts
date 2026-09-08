import { describe, expect, it } from 'vitest'
import { FIXTURE_TABLE, makePricingTable } from '../testing'
import type { BillableUsage } from './cost'
import { computeCostUsd, ZERO_USAGE } from './cost'
import { SHIPPED_PRICING } from './table'

const SEPTEMBER = new Date('2026-09-07T12:00:00Z')
const JANUARY_2027 = new Date('2027-01-02T00:00:00Z')

function usage(partial: Partial<BillableUsage>): BillableUsage {
  return { ...ZERO_USAGE, ...partial }
}

/**
 * Every figure below is hand-computed from the rate card and asserted with `toBe`. A
 * `toBeCloseTo` would pass for an 11x over-count on a small enough call.
 */
describe('computeCostUsd against the shipped table', () => {
  it('prices the acceptance call: role cheap, Gemini 3.7 Flash, September 2026', () => {
    // (4000 x 0.75 + 8000 x 0.075 + 900 x 3.75) / 1e6 = (3000 + 600 + 3375) / 1e6
    const cost = computeCostUsd(SHIPPED_PRICING, {
      modelKey: 'google:gemini-3.7-flash',
      usage: usage({
        inputTokens: 4000,
        cachedInputTokens: 8000,
        outputTokens: 900,
        reasoningTokens: 300,
      }),
      at: SEPTEMBER,
    })
    expect(cost.usd).toBe(0.006975)
  })

  it('doubles that call in 2027, from the same file', () => {
    const cost = computeCostUsd(SHIPPED_PRICING, {
      modelKey: 'google:gemini-3.7-flash',
      usage: usage({
        inputTokens: 4000,
        cachedInputTokens: 8000,
        outputTokens: 900,
        reasoningTokens: 300,
      }),
      at: JANUARY_2027,
    })
    expect(cost.usd).toBe(0.01395)
  })

  it('prices the acceptance fallback: Haiku 4.5, 1204 in / 318 out', () => {
    // (1204 x 1 + 318 x 5) / 1e6 = (1204 + 1590) / 1e6. Not 0.00279.
    const cost = computeCostUsd(SHIPPED_PRICING, {
      modelKey: 'anthropic:claude-haiku-4-5',
      usage: usage({ inputTokens: 1204, outputTokens: 318 }),
      at: SEPTEMBER,
    })
    expect(cost.usd).toBe(0.002794)
  })

  it('prices Sonnet 5 with and without a cached prefix, and halves it in batch', () => {
    const plain = computeCostUsd(SHIPPED_PRICING, {
      modelKey: 'anthropic:claude-sonnet-5',
      usage: usage({ inputTokens: 10_000, outputTokens: 2000 }),
      at: SEPTEMBER,
    })
    expect(plain.usd).toBe(0.04)

    const cached = computeCostUsd(SHIPPED_PRICING, {
      modelKey: 'anthropic:claude-sonnet-5',
      usage: usage({ inputTokens: 2000, cachedInputTokens: 8000, outputTokens: 2000 }),
      at: SEPTEMBER,
    })
    expect(cached.usd).toBe(0.0256)

    const batched = computeCostUsd(SHIPPED_PRICING, {
      modelKey: 'anthropic:claude-sonnet-5',
      usage: usage({ inputTokens: 10_000, outputTokens: 2000 }),
      at: SEPTEMBER,
      batch: true,
    })
    expect(batched.usd).toBe(0.02)
    expect(batched.batchApplied).toBe(true)
  })

  it('charges the two Anthropic cache-write tiers differently', () => {
    const short = computeCostUsd(SHIPPED_PRICING, {
      modelKey: 'anthropic:claude-sonnet-5',
      usage: usage({ cacheWriteTokens: 10_000 }),
      at: SEPTEMBER,
      cacheTtl: '5m',
    })
    const long = computeCostUsd(SHIPPED_PRICING, {
      modelKey: 'anthropic:claude-sonnet-5',
      usage: usage({ cacheWriteTokens: 10_000 }),
      at: SEPTEMBER,
      cacheTtl: '1h',
    })
    expect(short.usd).toBe(0.025)
    expect(long.usd).toBe(0.04)
  })

  it('adds the OpenRouter fee after the batch discount, as x1.055', () => {
    // The fee is on the payment: you pay 105.50 to receive 100 of credit. Not 1/(1-0.055).
    const cost = computeCostUsd(SHIPPED_PRICING, {
      modelKey: 'openrouter:deepseek/deepseek-v4-flash',
      usage: usage({ inputTokens: 1_000_000 }),
      at: SEPTEMBER,
    })
    expect(cost.aggregatorMultiplier).toBe(1.055)
    expect(cost.usd).toBe(0.4642)
  })
})

describe('computeCostUsd invariants', () => {
  it('never bills reasoning tokens twice', () => {
    const withReasoning = computeCostUsd(FIXTURE_TABLE, {
      modelKey: 'fixture:base',
      usage: usage({ outputTokens: 900, reasoningTokens: 300 }),
      at: SEPTEMBER,
    })
    const without = computeCostUsd(FIXTURE_TABLE, {
      modelKey: 'fixture:base',
      usage: usage({ outputTokens: 900, reasoningTokens: 0 }),
      at: SEPTEMBER,
    })
    expect(withReasoning.usd).toBe(without.usd)

    const informational = withReasoning.lines.filter((l) => l.informational)
    expect(informational.map((l) => l.kind)).toEqual(['reasoning'])
    const summed = withReasoning.lines
      .filter((l) => !l.informational)
      .reduce((total, l) => total + l.usd, 0)
    expect(summed).toBe(withReasoning.subtotalUsd)
  })

  it('bills cached and cache-write tokens at the input rate when there is no such tier', () => {
    const table = makePricingTable({
      'fixture:notiers': { rates: { cacheRead: null, cacheWrite5m: null, cacheWrite1h: null } },
    })
    const cost = computeCostUsd(table, {
      modelKey: 'fixture:notiers',
      usage: usage({ cachedInputTokens: 1_000_000, cacheWriteTokens: 1_000_000 }),
      at: SEPTEMBER,
    })
    // Never zero: that would under-report a charge that really happened.
    expect(cost.usd).toBe(2)
  })

  it('charges full price for batch on a model with no Batch API, and says so', () => {
    const table = makePricingTable({ 'fixture:nobatch': { rates: { batchDiscount: null } } })
    const cost = computeCostUsd(table, {
      modelKey: 'fixture:nobatch',
      usage: usage({ inputTokens: 1_000_000 }),
      at: SEPTEMBER,
      batch: true,
    })
    expect(cost.usd).toBe(1)
    expect(cost.batchApplied).toBe(false)
  })

  it('costs an empty usage at exactly zero', () => {
    // An error row that returned no usage must contribute nothing to a month's sumCost.
    const cost = computeCostUsd(FIXTURE_TABLE, {
      modelKey: 'fixture:base',
      usage: ZERO_USAGE,
      at: SEPTEMBER,
    })
    expect(cost.usd).toBe(0)
  })

  it('reports where the rates came from', () => {
    const cost = computeCostUsd(SHIPPED_PRICING, {
      modelKey: 'openrouter:deepseek/deepseek-v4-flash',
      usage: usage({ inputTokens: 1000 }),
      at: new Date('2026-09-07T18:00:00Z'),
    })
    expect(cost.baseModelKey).toBe('deepseek:deepseek-v4-flash')
    expect(cost.windowId).toBe('off-peak')
    expect(cost.aggregator).toBe('openrouter')
  })

  it('carries an unverified rate through to the breakdown', () => {
    const cost = computeCostUsd(SHIPPED_PRICING, {
      modelKey: 'anthropic:claude-fable-5-1',
      usage: usage({ inputTokens: 1000 }),
      at: SEPTEMBER,
    })
    expect(cost.unverified).toBe(true)
  })
})
