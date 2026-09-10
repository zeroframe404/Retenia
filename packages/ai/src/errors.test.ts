import { describe, expect, it } from 'vitest'
import {
  AI_ERROR_CODES,
  AiError,
  isAiError,
  MAX_ERROR_CHARS,
  redactAiError,
  redactKey,
} from './errors'

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

describe('redactAiError', () => {
  const key = 'sk-ant-api03-CANARY-7f3a'

  it('redacts the message, so a caller that persists it cannot leak the key', () => {
    // What a fetch-derived failure looks like when the provider carries the key in the URL.
    const raw = new AiError('auth', `401 from https://api.example/v1?key=${key}`, {
      profileId: 'p1',
      model: 'm1',
      statusCode: 401,
    })
    const redacted = redactAiError(raw, key)
    expect(redacted.message).not.toContain('CANARY')
    expect(redacted.message).toContain('«redacted»')
  })

  it('keeps the code and the context, so classify and ai_calls.meta still work', () => {
    const raw = new AiError('auth', `bad ${key}`, { profileId: 'p1', model: 'm1', statusCode: 401 })
    const redacted = redactAiError(raw, key)
    expect(redacted.code).toBe('auth')
    expect(redacted.profileId).toBe('p1')
    expect(redacted.model).toBe('m1')
    expect(redacted.statusCode).toBe(401)
  })

  it('redacts the cause too — a logger that walks the chain prints that, not the message', () => {
    const raw = new AiError(
      'network',
      'request failed',
      {},
      { cause: new Error(`GET ?key=${key}`) },
    )
    const redacted = redactAiError(raw, key)
    expect(String(redacted.cause)).not.toContain('CANARY')
  })

  it('returns the same error when there is nothing to redact', () => {
    const raw = new AiError('server_error', 'overloaded_error')
    expect(redactAiError(raw, key)).toBe(raw)
  })
})
