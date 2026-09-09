import { describe, expect, it } from 'vitest'
import { hasSpendRemaining, shouldSkipForCi, summarizeResults } from './run-evals.mjs'

describe('shouldSkipForCi', () => {
  it('skips whenever CI is set, regardless of its value', () => {
    expect(shouldSkipForCi({ CI: '1' })).toBe(true)
    expect(shouldSkipForCi({ CI: 'true' })).toBe(true)
  })

  it('runs locally, where CI is unset', () => {
    expect(shouldSkipForCi({})).toBe(false)
    expect(shouldSkipForCi({ CI: '' })).toBe(false)
  })
})

describe('hasSpendRemaining', () => {
  it('allows a call while spend is under the cap', () => {
    expect(hasSpendRemaining(0, 2)).toBe(true)
    expect(hasSpendRemaining(1.99, 2)).toBe(true)
  })

  it('refuses once spend has reached or passed the cap', () => {
    expect(hasSpendRemaining(2, 2)).toBe(false)
    expect(hasSpendRemaining(2.5, 2)).toBe(false)
  })
})

describe('summarizeResults', () => {
  it('reads a results[] shape with a boolean pass field', () => {
    const summary = summarizeResults({
      results: { results: [{ pass: true }, { pass: false }, { pass: true }] },
    })
    expect(summary).toEqual({ total: 3, passed: 2, rate: 2 / 3 })
  })

  it('reads a table.body[] shape with a success field', () => {
    const summary = summarizeResults({
      results: { table: { body: [{ success: true }, { success: true }] } },
    })
    expect(summary).toEqual({ total: 2, passed: 2, rate: 1 })
  })

  it('reads a nested gradingResult.pass shape', () => {
    const summary = summarizeResults({
      results: [{ gradingResult: { pass: true } }, { gradingResult: { pass: false } }],
    })
    expect(summary).toEqual({ total: 2, passed: 1, rate: 0.5 })
  })

  it('degrades to undefined — never throws — when nothing pass-shaped is found', () => {
    expect(
      summarizeResults({ some: 'unexpected shape from a future promptfoo version' }),
    ).toBeUndefined()
    expect(summarizeResults(null)).toBeUndefined()
    expect(summarizeResults([])).toBeUndefined()
  })
})
