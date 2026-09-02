import { describe, expect, it } from 'vitest'
import { APP_ORIGIN, allowedRendererOrigins, isAllowedSenderUrl, originOf } from './origins'

const allowed = [APP_ORIGIN]

describe('originOf', () => {
  it('reads the origin of a custom standard scheme', () => {
    // `new URL('app://retenia/x').origin` is the string 'null' for a non-special scheme,
    // which is why this helper exists at all.
    expect(originOf('app://retenia/index.html')).toBe('app://retenia')
    expect(new URL('app://retenia/index.html').origin).toBe('null')
  })

  it.each(['file:///home/user/index.html', 'about:blank', 'data:text/html,<p>x', 'not a url', ''])(
    'has no origin for %j',
    (url) => {
      expect(originOf(url)).toBeNull()
    },
  )
})

describe('isAllowedSenderUrl', () => {
  it('accepts the app origin', () => {
    expect(isAllowedSenderUrl('app://retenia/index.html', allowed)).toBe(true)
    expect(isAllowedSenderUrl('app://retenia/nested/route', allowed)).toBe(true)
  })

  it.each([
    ['a different host on the same scheme', 'app://evil/index.html'],
    ['a host that merely starts the same', 'app://retenia.evil.test/index.html'],
    ['a remote page', 'https://evil.test/'],
    ['the file scheme', 'file:///home/user/index.html'],
    ['a data URL', 'data:text/html,<script>1</script>'],
    ['garbage', 'not a url'],
  ])('rejects %s', (_label, url) => {
    expect(isAllowedSenderUrl(url, allowed)).toBe(false)
  })

  it('rejects a disposed frame, whose url is null or undefined', () => {
    expect(isAllowedSenderUrl(null, allowed)).toBe(false)
    expect(isAllowedSenderUrl(undefined, allowed)).toBe(false)
    expect(isAllowedSenderUrl('', allowed)).toBe(false)
  })
})

describe('allowedRendererOrigins', () => {
  it('trusts only the app origin in production', () => {
    expect(allowedRendererOrigins()).toEqual([APP_ORIGIN])
  })

  it('also trusts the dev server when one is running', () => {
    expect(allowedRendererOrigins('http://localhost:5173/')).toEqual([
      APP_ORIGIN,
      'http://localhost:5173',
    ])
  })

  it('ignores a dev server url it cannot parse', () => {
    expect(allowedRendererOrigins('nonsense')).toEqual([APP_ORIGIN])
  })
})
