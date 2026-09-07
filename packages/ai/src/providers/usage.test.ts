import type { LanguageModelUsage } from 'ai'
import { describe, expect, it } from 'vitest'
import { toBillableUsage } from './usage'

function usage(partial: {
  inputTokens?: number
  noCacheTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  outputTokens?: number
  textTokens?: number
  reasoningTokens?: number
}): LanguageModelUsage {
  return {
    inputTokens: partial.inputTokens,
    inputTokenDetails: {
      noCacheTokens: partial.noCacheTokens,
      cacheReadTokens: partial.cacheReadTokens,
      cacheWriteTokens: partial.cacheWriteTokens,
    },
    outputTokens: partial.outputTokens,
    outputTokenDetails: {
      textTokens: partial.textTokens,
      reasoningTokens: partial.reasoningTokens,
    },
    totalTokens: undefined,
  }
}

describe('toBillableUsage', () => {
  it('renames the five fields when the provider reports them all', () => {
    expect(
      toBillableUsage(
        usage({
          inputTokens: 12_000,
          noCacheTokens: 4000,
          cacheReadTokens: 7000,
          cacheWriteTokens: 1000,
          outputTokens: 900,
          textTokens: 600,
          reasoningTokens: 300,
        }),
      ),
    ).toEqual({
      inputTokens: 4000,
      cachedInputTokens: 7000,
      cacheWriteTokens: 1000,
      outputTokens: 900,
      reasoningTokens: 300,
    })
  })

  it('reads an entirely absent usage as zeros, never NaN', () => {
    expect(toBillableUsage(usage({}))).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    })
    expect(toBillableUsage(undefined)).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    })
  })

  it('derives the uncached count by subtraction — the double-charge guard', () => {
    // If `noCacheTokens` were missing and we fell back to `inputTokens`, the 8,000 cached
    // tokens would be billed at 1.0x AND again at 0.1x: an ~11x over-count on exactly the
    // mechanism caching exists to make cheap, and one that looks plausible in a total.
    expect(
      toBillableUsage(usage({ inputTokens: 12_000, cacheReadTokens: 8000, outputTokens: 100 })),
    ).toMatchObject({ inputTokens: 4000, cachedInputTokens: 8000 })
  })

  it('floors the derived count at zero rather than going negative', () => {
    expect(toBillableUsage(usage({ inputTokens: 100, cacheReadTokens: 900 })).inputTokens).toBe(0)
  })

  it('clamps reasoning to output, so the invariant holds for every row ever written', () => {
    expect(toBillableUsage(usage({ outputTokens: 500, reasoningTokens: 900 }))).toMatchObject({
      outputTokens: 500,
      reasoningTokens: 500,
    })
  })
})
