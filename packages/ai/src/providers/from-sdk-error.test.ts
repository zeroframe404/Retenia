import { APICallError } from 'ai'
import { describe, expect, it } from 'vitest'
import { classify } from '../retry'
import { fromSdkError } from './from-sdk-error'

const CONTEXT = { profileId: 'anthropic', model: 'claude-sonnet-5' }

describe('fromSdkError()', () => {
  it('reports a real cancellation as aborted, which classify() sends straight to give-up', () => {
    const cancelled = new Error('The operation was aborted')
    cancelled.name = 'AbortError'

    const error = fromSdkError(cancelled, CONTEXT, 'sk-test')

    expect(error.code).toBe('aborted')
    expect(classify(error, 1)).toBe('give-up')
  })

  it('reports a deadline as a network failure, so ordered fallback still gets a turn', () => {
    // `docs/spec/06-ai-providers.md` §6: "ordered fallback on 429/5xx/timeout" — a timeout
    // is not a decision the caller made, unlike a real cancellation, so the next target in
    // the role should still be tried rather than the whole call giving up.
    const timedOut = new Error('The operation timed out')
    timedOut.name = 'TimeoutError'

    const error = fromSdkError(timedOut, CONTEXT, 'sk-test')

    expect(error.code).toBe('network')
    expect(classify(error, 1)).toBe('retry')
    expect(classify(error, 2)).toBe('next-target')
  })

  it('redacts the key out of a timeout message that happened to echo it', () => {
    const timedOut = new Error('timed out calling sk-ant-CANARY-secret')
    timedOut.name = 'TimeoutError'

    expect(fromSdkError(timedOut, CONTEXT, 'sk-ant-CANARY-secret').message).not.toContain(
      'sk-ant-CANARY-secret',
    )
  })

  it('maps an APICallError by status, redacting the key', () => {
    const apiError = new APICallError({
      message: 'authentication_error: invalid x-api-key sk-ant-CANARY-secret',
      url: 'https://api.anthropic.com/v1/messages',
      requestBodyValues: {},
      statusCode: 429,
    })

    const error = fromSdkError(apiError, CONTEXT, 'sk-ant-CANARY-secret')

    expect(error.code).toBe('rate_limited')
    expect(error.message).not.toContain('sk-ant-CANARY-secret')
  })

  it('falls back to network for anything else, redacting the key', () => {
    const error = fromSdkError(new Error('ECONNRESET sk-test-value'), CONTEXT, 'sk-test-value')
    expect(error.code).toBe('network')
    expect(error.message).not.toContain('sk-test-value')
  })
})
