import { describe, expect, it } from 'vitest'
import { parseDeepLink } from './parse'

describe('parseDeepLink', () => {
  it('parses an import link', () => {
    expect(parseDeepLink('retenia://import?src=https%3A%2F%2Fexample.com%2Fbook.pdf')).toEqual({
      kind: 'import',
      src: 'https://example.com/book.pdf',
    })
  })

  it('rejects an import link with no src', () => {
    expect(parseDeepLink('retenia://import')).toBeNull()
    expect(parseDeepLink('retenia://import?src=')).toBeNull()
  })

  it.each([
    ['a local file URL', 'file:///C:/Users/x/.ssh/id_rsa'],
    ['a UNC-style path', '\\\\evil-host\\share\\payload'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,x'],
    ['a bare relative path', '../../etc/passwd'],
    ['not a url at all', 'not-a-url'],
  ])('rejects an import link whose src is %s', (_label, src) => {
    expect(parseDeepLink(`retenia://import?src=${encodeURIComponent(src)}`)).toBeNull()
  })

  it('accepts a plain http src, not only https', () => {
    expect(parseDeepLink('retenia://import?src=http%3A%2F%2Flocalhost%3A8080%2Fbook.pdf')).toEqual({
      kind: 'import',
      src: 'http://localhost:8080/book.pdf',
    })
  })

  it('parses a review link', () => {
    expect(parseDeepLink('retenia://review')).toEqual({ kind: 'review' })
  })

  it('treats a trailing slash the same as none', () => {
    expect(parseDeepLink('retenia://review/')).toEqual({ kind: 'review' })
  })

  it('rejects a review link with an extra path segment', () => {
    expect(parseDeepLink('retenia://review/today')).toBeNull()
  })

  it('parses an auth callback with its query params', () => {
    expect(parseDeepLink('retenia://auth/callback?code=abc&state=xyz')).toEqual({
      kind: 'authCallback',
      params: { code: 'abc', state: 'xyz' },
    })
  })

  it('parses an auth callback with no params', () => {
    expect(parseDeepLink('retenia://auth/callback')).toEqual({
      kind: 'authCallback',
      params: {},
    })
  })

  it.each([
    ['a bare auth host with no callback path', 'retenia://auth'],
    ['an auth host with the wrong path', 'retenia://auth/other'],
  ])('rejects %s', (_label, url) => {
    expect(parseDeepLink(url)).toBeNull()
  })

  it('rejects an unknown kind', () => {
    expect(parseDeepLink('retenia://somethingElse')).toBeNull()
  })

  it.each([
    ['a completely different scheme', 'https://retenia.app/review'],
    ['a scheme that merely contains the right one', 'notretenia://review'],
    ['no scheme separator at all', 'retenia:review'],
    ['a url it cannot parse', 'not a url'],
    ['an empty string', ''],
  ])('rejects %s', (_label, url) => {
    expect(parseDeepLink(url)).toBeNull()
  })
})
