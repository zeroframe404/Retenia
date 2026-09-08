import { describe, expect, it } from 'vitest'
import type { AiErrorCode } from './errors'
import { AiError } from './errors'
import {
  classify,
  MAX_ATTEMPTS_PER_TARGET,
  MIN_RETRY_MS,
  RETRY_BASE_MS,
  retryDelayMs,
} from './retry'

const error = (code: AiErrorCode): AiError => new AiError(code, 'test')

describe('classify', () => {
  it('never retries a 429 against the same target', () => {
    // The next target is a different key on a different service and is available now; when
    // the chain runs out, the job queue's 2^n-minute ladder is the minutes-scale answer.
    // This is also what makes the acceptance case exactly two rows with no configuration.
    expect(classify(error('rate_limited'), 1)).toBe('next-target')
    expect(classify(error('rate_limited'), 2)).toBe('next-target')
  })

  it('retries a transient failure once, then moves on', () => {
    for (const code of ['server_error', 'network'] as const) {
      expect(classify(error(code), 1), code).toBe('retry')
      expect(classify(error(code), MAX_ATTEMPTS_PER_TARGET), code).toBe('next-target')
    }
  })

  it('moves straight on from anything the same target cannot fix', () => {
    for (const code of ['auth', 'bad_request', 'not_configured', 'model_not_priced'] as const) {
      expect(classify(error(code), 1), code).toBe('next-target')
    }
  })

  it('gives up on a decision rather than trying elsewhere', () => {
    for (const code of ['budget_exceeded', 'aborted'] as const) {
      expect(classify(error(code), 1), code).toBe('give-up')
    }
  })
})

describe('retryDelayMs', () => {
  it('floors at MIN_RETRY_MS, so a retry is not a second hammer', () => {
    expect(retryDelayMs(() => 0)).toBe(MIN_RETRY_MS)
  })

  it('spreads over [MIN_RETRY_MS, RETRY_BASE_MS)', () => {
    expect(retryDelayMs(() => 0.5)).toBe(250)
    expect(retryDelayMs(() => 0.999)).toBeLessThan(RETRY_BASE_MS)
    expect(retryDelayMs(() => 0.999)).toBeGreaterThanOrEqual(MIN_RETRY_MS)
  })
})
