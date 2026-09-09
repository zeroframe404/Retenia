import { describe, expect, it } from 'vitest'
import {
  estimateGeneration,
  estimateWarnings,
  expectedConcepts,
  expectedModules,
  MODULE_OUTPUT_TOKENS,
  MODULE_TASK_TOKENS,
  P1_OUTPUT_TOKENS_PER_CHUNK,
} from './estimate-generation'

const cheap = {
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 5,
  cachedInputUsdPerMillion: 0.1,
  cacheWriteUsdPerMillion: 1.25,
}
const smart = {
  inputUsdPerMillion: 2,
  outputUsdPerMillion: 10,
  cachedInputUsdPerMillion: 0.2,
  cacheWriteUsdPerMillion: 2.5,
}

function chunks(count: number, tokens = 400) {
  return Array.from({ length: count }, () => ({
    text: 'x'.repeat(tokens * 4),
    context: null,
    tokenCount: tokens,
  }))
}

const systemTokens = { extract: 1000, outline: 1500, module: 1200 }

describe('estimateWarnings()', () => {
  it('reports an unpriced role only when there is a cap to enforce', () => {
    expect(estimateWarnings({ priced: { cheap: false, smart: true } }, 0)).toEqual([])
    expect(estimateWarnings({ priced: { cheap: true, smart: true } }, 5)).toEqual([])
    expect(estimateWarnings({ priced: { cheap: false, smart: false } }, 5)).toEqual([
      { code: 'estimate_unpriced', stage: 'extract', params: { role: 'cheap' } },
      { code: 'estimate_unpriced', stage: 'extract', params: { role: 'smart' } },
    ])
  })
})

describe('expectedConcepts() and expectedModules()', () => {
  it('follow §13’s 180 chunks → 212 concepts, clamped at the bottom', () => {
    expect(expectedConcepts(180)).toBe(216)
    expect(expectedConcepts(2)).toBe(8)
    expect(expectedModules(216)).toBe(27)
    expect(expectedModules(8)).toBe(2)
    expect(expectedModules(10_000)).toBe(40)
  })
})

describe('estimateGeneration()', () => {
  it('prices P1 per remaining chunk and P2 as one uncached outline plus cached module calls', () => {
    const estimate = estimateGeneration({
      chunks: chunks(10),
      alreadyExtracted: 4,
      rates: { cheap, smart },
      systemTokens,
      dispatch: 'sync',
    })
    expect(estimate).toMatchObject({
      chunks: 10,
      concepts: 12,
      modules: 2,
      dispatch: 'sync',
      priced: { cheap: true, smart: true },
    })
    // P1: 6 calls × (1000 + 400 + 120) in, 6 × 500 out.
    expect(estimate.p1).toEqual({
      calls: 6,
      inputTokens: 6 * 1520,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 6 * P1_OUTPUT_TOKENS_PER_CHUNK,
      usd: (6 * 1520 * 1 + 3000 * 5) / 1e6,
    })
    // The prefix: 12 × 10 + 45 × 12 = 660 tokens.
    expect(estimate.p2Outline).toEqual({
      calls: 1,
      inputTokens: 1500 + 660 + 300,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: Math.round(25 * 12 * 1.3) + 1500,
      usd: ((1500 + 660 + 300) * 2 + (Math.round(25 * 12 * 1.3) + 1500) * 10) / 1e6,
    })
    expect(estimate.p2Modules).toEqual({
      calls: 2,
      inputTokens: 2 * MODULE_TASK_TOKENS,
      cachedInputTokens: 1200 + 660,
      cacheWriteTokens: 1200 + 660,
      outputTokens: 2 * MODULE_OUTPUT_TOKENS,
      usd:
        (2 * MODULE_TASK_TOKENS * 2 +
          (1200 + 660) * 0.2 +
          (1200 + 660) * 2.5 +
          2 * MODULE_OUTPUT_TOKENS * 10) /
        1e6,
    })
    expect(estimate.usd).toBeCloseTo(
      estimate.p1.usd + estimate.p2Outline.usd + estimate.p2Modules.usd,
      6,
    )
    const p2 = estimate.p2Outline.usd + estimate.p2Modules.usd
    expect(estimate.lowUsd).toBeCloseTo(estimate.p1.usd * 0.9 + p2 * 0.7, 6)
    expect(estimate.highUsd).toBeCloseTo(estimate.p1.usd * 1.1 + p2 * 1.3, 6)
    // Sync minutes: 6 × 4 s / 6 workers + 25 s + 2 × 12 s / 3 = 37 s → 1 minute, twice that at most.
    expect(estimate.minutes).toEqual({ low: 1, high: 2 })
  })

  it('halves P1 on the batch path and quotes the batch’s latency instead of the pool’s', () => {
    const sync = estimateGeneration({
      chunks: chunks(10),
      alreadyExtracted: 0,
      rates: { cheap, smart },
      systemTokens,
      dispatch: 'sync',
    })
    const batch = estimateGeneration({
      chunks: chunks(10),
      alreadyExtracted: 0,
      rates: { cheap, smart },
      systemTokens,
      dispatch: 'batch',
    })
    expect(batch.p1.usd).toBeCloseTo(sync.p1.usd / 2, 9)
    expect(batch.p2Outline).toEqual(sync.p2Outline)
    expect(batch.minutes).toEqual({ low: 11, high: 61 })
    const none = estimateGeneration({
      chunks: chunks(10),
      alreadyExtracted: 0,
      rates: { cheap, smart },
      systemTokens,
      dispatch: 'batch',
      batchDiscount: 0,
    })
    expect(none.p1.usd).toBe(sync.p1.usd)
  })

  it('counts a chunk without a token count, and the context, through the counter', () => {
    const estimate = estimateGeneration({
      chunks: [{ text: 'abcd'.repeat(50), context: 'ctx'.repeat(20), tokenCount: 0 }],
      alreadyExtracted: 0,
      rates: { cheap },
      systemTokens,
      dispatch: 'sync',
      countTokens: (text) => text.length,
    })
    expect(estimate.p1.inputTokens).toBe(1000 + 200 + 60 + 120)
    expect(estimate.priced).toEqual({ cheap: true, smart: false })
    expect(estimate.p2Outline.usd).toBe(0)
    expect(estimate.p2Modules.usd).toBe(0)
  })

  it('quotes nothing for nothing, and only P2 when everything is already extracted', () => {
    const empty = estimateGeneration({
      chunks: [],
      alreadyExtracted: 0,
      rates: {},
      systemTokens,
      dispatch: 'batch',
    })
    expect(empty).toMatchObject({
      chunks: 0,
      usd: 0,
      lowUsd: 0,
      highUsd: 0,
      minutes: { low: 0, high: 0 },
    })
    expect(empty.p1.calls).toBe(0)
    expect(empty.p2Outline.calls).toBe(0)
    expect(empty.p2Modules.calls).toBe(0)

    const done = estimateGeneration({
      chunks: chunks(3),
      alreadyExtracted: 3,
      rates: { cheap, smart },
      systemTokens,
      dispatch: 'batch',
    })
    expect(done.p1.calls).toBe(0)
    expect(done.p1.usd).toBe(0)
    expect(done.p2Outline.calls).toBe(1)
    // No P1 calls means no batch to wait for.
    expect(done.minutes.high).toBeLessThan(10)
  })

  it('falls back to the input rate when a rate card has no cache prices', () => {
    const bare = { inputUsdPerMillion: 2, outputUsdPerMillion: 10 }
    const estimate = estimateGeneration({
      chunks: chunks(4),
      alreadyExtracted: 0,
      rates: { smart: bare },
      systemTokens,
      dispatch: 'sync',
      concurrency: { extract: 1, modules: 1 },
    })
    const tokens = estimate.p2Modules
    expect(tokens.usd).toBeCloseTo(
      ((tokens.inputTokens + tokens.cachedInputTokens + tokens.cacheWriteTokens) * 2 +
        tokens.outputTokens * 10) /
        1e6,
      9,
    )
  })
})
