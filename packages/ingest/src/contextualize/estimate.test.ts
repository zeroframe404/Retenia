import { describe, expect, it } from 'vitest'
import { countTokensByChars } from '../chunking'
import {
  CONTEXT_OUTPUT_TOKENS,
  DEFAULT_CONTEXTUALIZATION_PRICING,
  estimateContextualization,
} from './estimate'
import { loadContextualizePrompt } from './prompt-files'
import { systemFromTemplate } from './task'

const SYSTEM = systemFromTemplate(loadContextualizePrompt())
const DOCUMENT = {
  title: 'Memoria y repaso',
  kind: 'pdf',
  language: 'es',
  summary: 'x'.repeat(1_200),
  outline: '- Capítulo 1\n- Capítulo 2',
}

const chunks = (count: number, chars = 1_600) =>
  Array.from({ length: count }, () => ({ text: 'y'.repeat(chars) }))

describe('estimateContextualization', () => {
  it('quotes zero for nothing to do', () => {
    expect(estimateContextualization([], { systemPrompt: SYSTEM, document: DOCUMENT })).toEqual({
      chunkCount: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      usd: 0,
    })
  })

  it('charges the document prefix once when the provider caches it', () => {
    const cached = estimateContextualization(chunks(180), {
      systemPrompt: SYSTEM,
      document: DOCUMENT,
      promptCaching: true,
    })
    const uncached = estimateContextualization(chunks(180), {
      systemPrompt: SYSTEM,
      document: DOCUMENT,
      promptCaching: false,
    })

    expect(cached.cachedInputTokens).toBeGreaterThan(0)
    expect(uncached.cachedInputTokens).toBe(0)
    expect(cached.usd).toBeLessThan(uncached.usd)
  })

  it('counts the output at the top of the band the prompt asks for', () => {
    const estimate = estimateContextualization(chunks(10), {
      systemPrompt: SYSTEM,
      document: DOCUMENT,
    })
    expect(estimate.outputTokens).toBe(CONTEXT_OUTPUT_TOKENS * 10)
    expect(estimate.chunkCount).toBe(10)
  })

  it('lands in the order of magnitude the ingestion spec budgets for a book', () => {
    // §6 of docs/spec/05-ingestion-rag.md: contextual retrieval over ~640k tokens costs
    // ≈ USD 0.15 (Flash-Lite) to ≈ 0.65 (Haiku 4.5 batch). A 300-page book is ~180 chunks.
    const estimate = estimateContextualization(chunks(180, 1_600), {
      systemPrompt: SYSTEM,
      document: DOCUMENT,
      pricing: DEFAULT_CONTEXTUALIZATION_PRICING,
    })
    expect(estimate.usd).toBeGreaterThan(0.01)
    expect(estimate.usd).toBeLessThan(1)
  })

  it('is linear in the chunks it is actually given, so a resumed run quotes less', () => {
    const all = estimateContextualization(chunks(100), {
      systemPrompt: SYSTEM,
      document: DOCUMENT,
    })
    const rest = estimateContextualization(chunks(40), { systemPrompt: SYSTEM, document: DOCUMENT })
    expect(rest.usd).toBeLessThan(all.usd)
  })

  it('uses the counter it is given', () => {
    const doubled = estimateContextualization(chunks(5), {
      systemPrompt: SYSTEM,
      document: DOCUMENT,
      countTokens: (text) => countTokensByChars(text) * 2,
    })
    const plain = estimateContextualization(chunks(5), { systemPrompt: SYSTEM, document: DOCUMENT })
    expect(doubled.inputTokens).toBe(plain.inputTokens * 2)
  })
})
