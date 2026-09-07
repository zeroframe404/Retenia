import { describe, expect, it } from 'vitest'
import { budgetState, crossedThresholds, monthKey, startOfMonth } from './budget'

/**
 * Every date here is built with the LOCAL `new Date(y, m, d, …)` constructor, never an ISO
 * string ending in `Z`.
 *
 * CI runs in UTC and the development machine is ART (UTC-3). An ISO fixture near a month
 * edge resolves to a different month in the two places, and the tempting fix when that
 * fails — "just use UTC everywhere" — is exactly the change that makes a user's budget
 * disagree with their provider invoice. Keep both sides local.
 */
describe('month boundaries', () => {
  it('names the local calendar month', () => {
    expect(monthKey(new Date(2026, 11, 31, 23, 59))).toBe('2026-12')
    expect(monthKey(new Date(2027, 0, 1, 0, 0))).toBe('2027-01')
    expect(monthKey(new Date(2026, 8, 7, 14, 3))).toBe('2026-09')
  })

  it('starts the month at local midnight on the first', () => {
    expect(startOfMonth(new Date(2026, 8, 7, 14, 3, 27, 811))).toEqual(new Date(2026, 8, 1))
  })
})

describe('budgetState', () => {
  it('warns at exactly 80 % and exhausts at exactly 100 %', () => {
    expect(budgetState(23.99, 30)).toBe('ok')
    expect(budgetState(24, 30)).toBe('warning')
    expect(budgetState(29.99, 30)).toBe('warning')
    expect(budgetState(30, 30)).toBe('exhausted')
    expect(budgetState(45, 30)).toBe('exhausted')
  })

  it('treats a cap of zero as no cap', () => {
    // A user who types 0 meaning "no AI spending" is served by the provider allowlist. If
    // 0 meant "block everything", the most restrictive setting in the app would be the
    // one an unset number falls back to.
    expect(budgetState(1000, 0)).toBe('ok')
  })
})

describe('crossedThresholds', () => {
  it('fires on the transition, not on the state', () => {
    expect(crossedThresholds(7.5, 8.5, 10)).toEqual([80])
    // Already past it: a second call in the same month is silent, which is also what makes
    // this survive a restart, because `spentBefore` is read back from the real rows.
    expect(crossedThresholds(8.5, 9.0, 10)).toEqual([])
    expect(crossedThresholds(9.5, 10.5, 10)).toEqual([100])
  })

  it('reports both lines, in order, when one call crosses them together', () => {
    expect(crossedThresholds(1, 40, 10)).toEqual([80, 100])
  })

  it('is silent when there is no cap', () => {
    expect(crossedThresholds(0, 1000, 0)).toEqual([])
  })
})
