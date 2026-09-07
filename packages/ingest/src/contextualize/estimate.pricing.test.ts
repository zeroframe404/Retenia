import type { PerMillionRates } from '@retenia/ai'
import { computeCostUsd, SHIPPED_PRICING, toPerMillionRates } from '@retenia/ai'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { ChunkDraft } from '../chunking'
import { countTokensByChars } from '../chunking'
import type { ContextualizationPricing } from './estimate'
import {
  CONTEXT_OUTPUT_TOKENS,
  DEFAULT_CONTEXTUALIZATION_PRICING,
  estimateContextualization,
} from './estimate'
import { buildDocumentBlock, type DocumentContext } from './task'

/**
 * The pin between what the app **quotes** and what it will actually be **charged**.
 *
 * `estimate.ts` promises the quote is "an exact function of the price table it is given";
 * sub-phase 7.1 is where that table stops being a hardcoded default and starts being
 * `@retenia/ai`'s versioned one. These tests fail if either side moves without the other.
 */

const AT = new Date('2026-09-07T12:00:00Z')

const SYSTEM = 'You write a one-sentence context for a chunk of a document.'
const DOCUMENT: DocumentContext = {
  title: 'Cálculo I',
  kind: 'pdf',
  language: 'es',
  summary: 'Un curso introductorio de límites, derivadas e integrales.',
  outline: '1. Límites\n  1.1 Definición\n2. Derivadas',
}

function chunks(count: number): ChunkDraft[] {
  return Array.from({ length: count }, (_, index) => ({
    text: `Chunk number ${index}. `.repeat(20),
  })) as ChunkDraft[]
}

describe('the shipped table agrees with the estimator default', () => {
  it('reproduces DEFAULT_CONTEXTUALIZATION_PRICING exactly', () => {
    // Haiku 4.5 through the Batch API, which is what §4.2 names for this job: 1 / 5 per
    // million, cache read 0.1x, 5-minute cache write 1.25x, all halved by Batch.
    const rates = toPerMillionRates(SHIPPED_PRICING, 'anthropic:claude-haiku-4-5', {
      at: AT,
      batch: true,
      cacheTtl: '5m',
    })
    expect(rates).toEqual(DEFAULT_CONTEXTUALIZATION_PRICING)
    expect(rates).toEqual({
      inputUsdPerMillion: 0.5,
      outputUsdPerMillion: 2.5,
      cachedInputUsdPerMillion: 0.05,
      cacheWriteUsdPerMillion: 0.625,
    })
  })

  it('keeps the two rate-card types structurally identical', () => {
    // They are redeclared rather than shared, because the dependency edge runs ingest -> ai
    // and never back. This is what makes that safe.
    expectTypeOf<PerMillionRates>().toExtend<ContextualizationPricing>()
    expectTypeOf<ContextualizationPricing>().toExtend<PerMillionRates>()
  })
})

describe('the quote and the charge compute the same number', () => {
  const cases = [0, 1, 10, 180]

  for (const count of cases) {
    it(`agrees over ${count} chunk(s), with no caching`, () => {
      const drafts = chunks(count)
      const pricing = toPerMillionRates(SHIPPED_PRICING, 'anthropic:claude-haiku-4-5', {
        at: AT,
        batch: true,
        cacheTtl: '5m',
      })
      const estimate = estimateContextualization(drafts, {
        systemPrompt: SYSTEM,
        document: DOCUMENT,
        pricing,
        promptCaching: false,
      })

      // Recomputed from the SAME inputs rather than from the estimate's return value:
      // `estimate.inputTokens` is a display total that includes cached tokens, where
      // `BillableUsage.inputTokens` means uncached. Feeding one into the other would make
      // this test pass while the two definitions silently disagreed.
      const prefix = countTokensByChars(SYSTEM) + countTokensByChars(buildDocumentBlock(DOCUMENT))
      const body = drafts.reduce((sum, chunk) => sum + countTokensByChars(chunk.text), 0)
      const charge = computeCostUsd(SHIPPED_PRICING, {
        modelKey: 'anthropic:claude-haiku-4-5',
        usage: {
          inputTokens: count === 0 ? 0 : prefix * count + body,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: CONTEXT_OUTPUT_TOKENS * count,
          reasoningTokens: 0,
        },
        at: AT,
        batch: true,
        cacheTtl: '5m',
      })

      expect(estimate.usd).toBeCloseTo(charge.usd, 9)
    })
  }
})

describe('the two additive fields', () => {
  const drafts = chunks(10)
  const prefix = countTokensByChars(SYSTEM) + countTokensByChars(buildDocumentBlock(DOCUMENT))
  const body = drafts.reduce((sum, chunk) => sum + countTokensByChars(chunk.text), 0)

  it('splits the prefix into a cache write when caching is on', () => {
    const estimate = estimateContextualization(drafts, {
      systemPrompt: SYSTEM,
      document: DOCUMENT,
      promptCaching: true,
    })
    expect(estimate.cacheWriteTokens).toBe(prefix)
    expect(estimate.uncachedInputTokens).toBe(body)
    expect(estimate.inputTokens).toBe(
      estimate.uncachedInputTokens + estimate.cacheWriteTokens + estimate.cachedInputTokens,
    )
  })

  it('charges every call for the prefix when caching is off', () => {
    const estimate = estimateContextualization(drafts, {
      systemPrompt: SYSTEM,
      document: DOCUMENT,
      promptCaching: false,
    })
    expect(estimate.cacheWriteTokens).toBe(0)
    expect(estimate.cachedInputTokens).toBe(0)
    expect(estimate.uncachedInputTokens).toBe(prefix * drafts.length + body)
    expect(estimate.inputTokens).toBe(
      estimate.uncachedInputTokens + estimate.cacheWriteTokens + estimate.cachedInputTokens,
    )
  })

  it('leaves the display total and the price unchanged', () => {
    // Purely additive: this sub-phase must not move a number the user already sees.
    for (const caching of [true, false]) {
      const estimate = estimateContextualization(drafts, {
        systemPrompt: SYSTEM,
        document: DOCUMENT,
        promptCaching: caching,
      })
      const cached = caching ? prefix * (drafts.length - 1) : 0
      const uncachedPrefix = caching ? prefix : prefix * drafts.length
      expect(estimate.inputTokens).toBe(uncachedPrefix + body + cached)
      expect(estimate.cachedInputTokens).toBe(cached)
    }
  })
})
