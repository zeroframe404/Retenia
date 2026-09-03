import { describe, expect, it } from 'vitest'
import { contract } from '../index'
import { SECRET_NAMES } from './secrets'

describe('secret name vocabulary', () => {
  /** Mirrors `SECRET_NAMES` in `packages/core/src/ports/secret-store.ts` — this leaf
   *  package cannot import `@retenia/core` (see the comment on `SECRET_NAMES` above), so
   *  this is the assertion that catches drift between the two copies. */
  it('matches the provider names core provisions storage for', () => {
    expect([...SECRET_NAMES]).toEqual([
      'anthropic',
      'google',
      'openai',
      'azure_speech',
      'elevenlabs',
      'openrouter',
      'deepgram',
      'bfl',
      'recraft',
    ])
  })
})

describe('secrets.set', () => {
  const { input, output } = contract['secrets.set']

  it('accepts a known name and a non-empty value', () => {
    expect(input.parse({ name: 'anthropic', value: 'sk-ant-...' })).toEqual({
      name: 'anthropic',
      value: 'sk-ant-...',
    })
  })

  it('rejects an unknown provider name', () => {
    expect(input.safeParse({ name: 'not-a-provider', value: 'x' }).success).toBe(false)
  })

  it('rejects an empty value', () => {
    expect(input.safeParse({ name: 'anthropic', value: '' }).success).toBe(false)
  })

  it('output never has room for the plaintext value', () => {
    expect(output.parse({ ok: true })).toEqual({ ok: true })
  })
})

describe('secrets.get', () => {
  const { output } = contract['secrets.get']

  it('only ever carries a boolean and a masked preview', () => {
    expect(output.parse({ hasSecret: true, preview: '••••wxyz' })).toEqual({
      hasSecret: true,
      preview: '••••wxyz',
    })
    expect(output.parse({ hasSecret: false, preview: null })).toEqual({
      hasSecret: false,
      preview: null,
    })
  })
})
