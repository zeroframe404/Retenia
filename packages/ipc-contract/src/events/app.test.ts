import { describe, expect, it } from 'vitest'
import { deepLinkSchema } from './app'

describe('deepLinkSchema', () => {
  it('accepts an http(s) import src', () => {
    expect(
      deepLinkSchema.safeParse({ kind: 'import', src: 'https://example.com/book.pdf' }).success,
    ).toBe(true)
    expect(
      deepLinkSchema.safeParse({ kind: 'import', src: 'http://example.com/book.pdf' }).success,
    ).toBe(true)
  })

  it.each([
    ['a local file URL', 'file:///etc/passwd'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,x'],
    ['not a url at all', 'not-a-url'],
  ])('rejects an import src that is %s', (_label, src) => {
    expect(deepLinkSchema.safeParse({ kind: 'import', src }).success).toBe(false)
  })

  it('accepts a review link', () => {
    expect(deepLinkSchema.safeParse({ kind: 'review' }).success).toBe(true)
  })
})
