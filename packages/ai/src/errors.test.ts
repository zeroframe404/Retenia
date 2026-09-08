import { describe, expect, it } from 'vitest'
import { AI_ERROR_CODES, AiError, isAiError, MAX_ERROR_CHARS, redactKey } from './errors'

describe('AiError', () => {
  it('marks exactly the transient codes retryable', () => {
    const retryable = AI_ERROR_CODES.filter((code) => new AiError(code, 'x').retryable)
    expect([...retryable]).toEqual(['server_error', 'network'])
  })

  it('carries the context a fallback decision needs', () => {
    const error = new AiError('rate_limited', 'slow down', {
      profileId: 'google',
      model: 'gemini-3.7-flash',
      statusCode: 429,
    })
    expect(isAiError(error)).toBe(true)
    expect([error.profileId, error.model, error.statusCode]).toEqual([
      'google',
      'gemini-3.7-flash',
      429,
    ])
  })

  it('is not confused with a plain Error', () => {
    expect(isAiError(new Error('nope'))).toBe(false)
  })
})

describe('redactKey', () => {
  it('removes every occurrence of the key', () => {
    const key = 'sk-ant-api03-CANARY-7f3a'
    const message = `401 for ${key}; retried with ${key}`
    const redacted = redactKey(message, key)
    expect(redacted).not.toContain(key)
    // Not just the whole key: no run of it survives either.
    expect(redacted).not.toContain('CANARY')
    expect(redacted).toContain('«redacted»')
  })

  it('caps a runaway message, so an echoed request body cannot fill the column', () => {
    const redacted = redactKey('x'.repeat(4000), undefined)
    expect(redacted.length).toBe(MAX_ERROR_CHARS)
  })

  it('leaves an ordinary message alone', () => {
    expect(redactKey('overloaded_error', 'sk-key')).toBe('overloaded_error')
  })

  it('is a no-op for an empty key rather than replacing every character', () => {
    expect(redactKey('hello', '')).toBe('hello')
  })
})
