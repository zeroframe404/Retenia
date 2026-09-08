import { describe, expect, it } from 'vitest'
import { computeCostUsd, SHIPPED_PRICING } from '../pricing'
import { makePricingTable } from '../testing'
import type { TextGenerationRequest } from '../text-generator'
import { approximateTokens } from '../tokens'
import { DEFAULT_OUTPUT_TOKENS_PER_REQUEST, estimateBatch } from './estimate'
import type { BatchRequest } from './provider'

const AT = new Date('2026-09-08T12:00:00Z')

/** `chars / 4`, so 4n characters is n tokens. */
const chars = (tokens: number): string => 'x'.repeat(tokens * 4)

const SYSTEM = chars(500)
const PREFIX = chars(4000)

function lesson(index: number, over: Partial<TextGenerationRequest> = {}): BatchRequest {
  return {
    customId: `lesson-${index}`,
    request: {
      system: SYSTEM,
      prompt: chars(200),
      temperature: 0.6,
      maxOutputTokens: 8000,
      ...over,
    },
  }
}

/** Sonnet 5 at 2/10 with a 0.2 cache read and a 2.5 5-minute write, plus the -50 % batch. */
const table = makePricingTable({
  'fixture:model': {
    rates: {
      input: 2,
      output: 10,
      cacheRead: 0.2,
      cacheWrite5m: 2.5,
      cacheWrite1h: 4,
      batchDiscount: 0.5,
    },
  },
  // The same rate card with the Batch column struck out, so a comparison between the two
  // isolates the discount instead of comparing two different models.
  'fixture:nobatch': {
    rates: {
      input: 2,
      output: 10,
      cacheRead: 0.2,
      cacheWrite5m: 2.5,
      cacheWrite1h: 4,
      batchDiscount: null,
    },
  },
})

const options = { modelKey: 'fixture:model', at: AT, batch: true } as const

describe('estimateBatch', () => {
  it('prices an uncached batch as tokens times the rate card', () => {
    const requests = Array.from({ length: 40 }, (_, index) => lesson(index))
    const estimate = estimateBatch(table, requests, {
      ...options,
      outputTokensPerRequest: 4000,
    })

    expect(estimate.requests).toBe(40)
    // Every request pays for the system, the prompt and nothing else — there is no prefix.
    expect(estimate.inputTokens).toBe(
      40 * (approximateTokens(SYSTEM) + approximateTokens(chars(200))),
    )
    expect(estimate.cachedInputTokens).toBe(0)
    expect(estimate.cacheWriteTokens).toBe(0)
    expect(estimate.outputTokens).toBe(40 * 4000)

    // Checked against the cost model itself rather than a hand-computed constant: the point
    // of the assertion is that the quote and the charge come from one place.
    const expected = computeCostUsd(table, {
      modelKey: 'fixture:model',
      usage: {
        inputTokens: estimate.inputTokens,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: estimate.outputTokens,
        reasoningTokens: 0,
      },
      at: AT,
      batch: true,
    })
    expect(estimate.usd).toBe(expected.usd)
    expect(estimate.batchDiscountApplied).toBe(true)
  })

  it('charges a shared cached prefix once as a write and once per later request as a read', () => {
    const cache = { ttl: '1h', system: true, prefix: true } as const
    const requests = Array.from({ length: 40 }, (_, index) =>
      lesson(index, { cachePrefix: PREFIX, cache }),
    )

    const estimate = estimateBatch(table, requests, options)
    const head = approximateTokens(SYSTEM) + approximateTokens(PREFIX)

    expect(estimate.cacheWriteTokens).toBe(head)
    expect(estimate.cachedInputTokens).toBe(39 * head)
    // Only the volatile task is charged at the input rate.
    expect(estimate.inputTokens).toBe(40 * approximateTokens(chars(200)))
  })

  it('is dramatically cheaper with caching than without, on the same requests', () => {
    // The quote has to *show* the saving the sub-phase exists to produce, or the toggle in
    // front of it is a claim nobody can check.
    const cache = { ttl: '1h', system: true, prefix: true } as const
    const cached = estimateBatch(
      table,
      Array.from({ length: 40 }, (_, index) => lesson(index, { cachePrefix: PREFIX, cache })),
      options,
    )
    const uncached = estimateBatch(
      table,
      Array.from({ length: 40 }, (_, index) => lesson(index, { cachePrefix: PREFIX })),
      options,
    )

    expect(cached.usd).toBeLessThan(uncached.usd)
    expect(cached.cachedInputTokens).toBeGreaterThan(0)
    expect(uncached.cachedInputTokens).toBe(0)
  })

  it('bills a 1 h write at the higher tier', () => {
    const oneHour = estimateBatch(
      table,
      [lesson(0, { cachePrefix: PREFIX, cache: { ttl: '1h', system: true, prefix: true } })],
      options,
    )
    const fiveMinutes = estimateBatch(
      table,
      [lesson(0, { cachePrefix: PREFIX, cache: { ttl: '5m', system: true, prefix: true } })],
      options,
    )

    expect(oneHour.usd).toBeGreaterThan(fiveMinutes.usd)
  })

  it('quotes a provider with no Batch API at full price', () => {
    // The sequential fallback is billed as ordinary calls, and a quote that applied the
    // discount anyway would be exactly half of what the user is charged.
    const requests = [lesson(0)]
    const discounted = estimateBatch(table, requests, options)
    const fullPrice = estimateBatch(table, requests, {
      ...options,
      modelKey: 'fixture:nobatch',
    })

    expect(discounted.batchDiscountApplied).toBe(true)
    expect(fullPrice.batchDiscountApplied).toBe(false)
    expect(fullPrice.usd).toBeGreaterThan(discounted.usd)
  })

  it('publishes a ±10 % band around the midpoint, matching the tokenizer it used', () => {
    const estimate = estimateBatch(table, [lesson(0)], options)
    expect(estimate.lowUsd).toBeCloseTo(estimate.usd * 0.9, 10)
    expect(estimate.highUsd).toBeCloseTo(estimate.usd * 1.1, 10)
  })

  it('never quotes more output than maxOutputTokens allows', () => {
    const capped = estimateBatch(table, [lesson(0, { maxOutputTokens: 500 })], {
      ...options,
      outputTokensPerRequest: 4000,
    })
    expect(capped.outputTokens).toBe(500)
  })

  it('falls back to a documented per-request output guess', () => {
    const estimate = estimateBatch(table, [lesson(0, { maxOutputTokens: undefined })], options)
    expect(estimate.outputTokens).toBe(DEFAULT_OUTPUT_TOKENS_PER_REQUEST)
  })

  it('prices an empty selection at zero without losing the discount flag', () => {
    const estimate = estimateBatch(table, [], options)
    expect(estimate).toMatchObject({ requests: 0, usd: 0, lowUsd: 0, highUsd: 0 })
    expect(estimate.batchDiscountApplied).toBe(true)
  })

  it('reproduces the shipped Sonnet 5 figure for a book-sized generation run', () => {
    // `04-path-generation.md` §6, the "Lessons" row: ~40 lessons at 14k in of which 5k is a
    // cached prefix, 4k out, on Sonnet 5 through the Batch API — **USD 1.18**. That number
    // was computed by hand for the spec; this estimator is a different code path and has to
    // land on it, or one of the two is lying to the user before they spend the money.
    const cache = { ttl: '5m', system: true, prefix: true } as const
    const requests = Array.from({ length: 40 }, (_, index) => ({
      customId: `L${index}`,
      request: {
        cachePrefix: chars(5_000),
        prompt: chars(9_000),
        temperature: 0.6,
        cache,
      } satisfies TextGenerationRequest,
    }))

    const estimate = estimateBatch(SHIPPED_PRICING, requests, {
      modelKey: 'anthropic:claude-sonnet-5',
      at: AT,
      batch: true,
      outputTokensPerRequest: 4_000,
    })

    expect(estimate.usd).toBeGreaterThan(1.12)
    expect(estimate.usd).toBeLessThan(1.24)
  })
})
