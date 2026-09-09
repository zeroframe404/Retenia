import { describe, expect, it } from 'vitest'
import { createBudgetGuard, UNLIMITED_BUDGET } from './budget'
import { GenerationError, isGenerationError } from './errors'

describe('createBudgetGuard()', () => {
  it('blocks only past the cap, and never without one', () => {
    const guard = createBudgetGuard(1, 0.25)
    expect(guard.capUsd).toBe(1)
    expect(guard.spentUsd()).toBe(0.25)
    expect(guard.wouldExceed(0.75)).toBe(false)
    expect(guard.wouldExceed(0.76)).toBe(true)
    guard.add(0.5)
    expect(guard.spentUsd()).toBe(0.75)
    expect(guard.wouldExceed(0.3)).toBe(true)

    const uncapped = createBudgetGuard(0, 100)
    expect(uncapped.wouldExceed(1e9)).toBe(false)
    expect(UNLIMITED_BUDGET.wouldExceed(1e9)).toBe(false)
    UNLIMITED_BUDGET.add(5)
    expect(UNLIMITED_BUDGET.spentUsd()).toBe(0)
  })
})

describe('GenerationError', () => {
  it('carries a code and is recognisable across bundle boundaries', () => {
    const error = new GenerationError('no_chunks', 'nothing to read')
    expect(error.name).toBe('GenerationError')
    expect(error.code).toBe('no_chunks')
    expect(error.message).toBe('nothing to read')
    expect(isGenerationError(error)).toBe(true)
    expect(isGenerationError(new Error('x'))).toBe(false)
    expect(isGenerationError('x')).toBe(false)
  })
})
