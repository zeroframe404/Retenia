import { describe, expect, it } from 'vitest'
import { POLL_BASE_MS, POLL_MAX_MS, pollDelayMs } from './backoff'

/** Jitter is a `Random`, so every delay here is a value and not a range. */
const noJitter = () => 0.5

describe('pollDelayMs', () => {
  it('starts at five seconds and doubles', () => {
    expect(pollDelayMs(1, noJitter)).toBe(POLL_BASE_MS)
    expect(pollDelayMs(2, noJitter)).toBe(POLL_BASE_MS * 2)
    expect(pollDelayMs(3, noJitter)).toBe(POLL_BASE_MS * 4)
  })

  it('caps at five minutes however long a batch has been stuck', () => {
    // §2 allows 24 h. `2 ** attempt` over that many polls overflows to Infinity if the cap is
    // applied after the exponent rather than to it.
    expect(pollDelayMs(20, noJitter)).toBe(POLL_MAX_MS)
    expect(pollDelayMs(500, noJitter)).toBe(POLL_MAX_MS)
    expect(Number.isFinite(pollDelayMs(5000, noJitter))).toBe(true)
  })

  it('spreads the wake-ups of batches submitted together', () => {
    const earliest = pollDelayMs(4, () => 0)
    const latest = pollDelayMs(4, () => 1)
    expect(earliest).toBeLessThan(latest)
    expect(earliest).toBeGreaterThanOrEqual(POLL_BASE_MS * 8 * 0.8 - 1)
    expect(latest).toBeLessThanOrEqual(POLL_BASE_MS * 8 * 1.2 + 1)
  })

  it('obeys the provider Retry-After over its own guess', () => {
    // `retry.ts` says batch polling would be the first caller with any use for the header.
    // A 429 answered sooner than the provider asked is how a backoff becomes a spiral.
    expect(pollDelayMs(1, noJitter, 42_000)).toBe(42_000)
    expect(pollDelayMs(9, noJitter, 1_000)).toBe(1_000)
  })

  it('ignores a Retry-After that is not a delay', () => {
    expect(pollDelayMs(1, noJitter, Number.NaN)).toBe(POLL_BASE_MS)
    expect(pollDelayMs(1, noJitter, -5)).toBe(POLL_BASE_MS)
    expect(pollDelayMs(1, noJitter, 0)).toBe(POLL_BASE_MS)
  })

  it('never waits less than a second', () => {
    expect(pollDelayMs(0, () => 0)).toBeGreaterThanOrEqual(1_000)
  })
})
