import { describe, expect, it } from 'vitest'
import { backoffDelayMs, MAX_BACKOFF_MS, nextRetryAt } from './backoff'

const MINUTE = 60_000

describe('backoff', () => {
  it('waits 2^n minutes after n failures', () => {
    expect(backoffDelayMs(1)).toBe(2 * MINUTE)
    expect(backoffDelayMs(2)).toBe(4 * MINUTE)
    expect(backoffDelayMs(3)).toBe(8 * MINUTE)
    expect(backoffDelayMs(4)).toBe(16 * MINUTE)
  })

  it('treats a zeroth failure as the first, rather than returning no delay at all', () => {
    expect(backoffDelayMs(0)).toBe(2 * MINUTE)
  })

  it('caps the wait so a raised maxAttempts cannot schedule a retry days out', () => {
    expect(backoffDelayMs(6)).toBe(MAX_BACKOFF_MS)
    expect(backoffDelayMs(500)).toBe(MAX_BACKOFF_MS)
    expect(Number.isFinite(backoffDelayMs(5000))).toBe(true)
  })

  it('honours an overridden base and cap', () => {
    expect(backoffDelayMs(1, { baseMs: 1000 })).toBe(2000)
    expect(backoffDelayMs(10, { maxMs: 5000 })).toBe(5000)
  })

  it('turns the delay into an instant', () => {
    const now = new Date('2026-09-02T00:00:00.000Z')
    expect(nextRetryAt(1, now).toISOString()).toBe('2026-09-02T00:02:00.000Z')
  })
})
