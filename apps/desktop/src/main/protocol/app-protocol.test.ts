import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// The module reaches for `net` and `protocol` at import time; only the pure path resolver
// is under test here, and Electron is not running.
vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}))

const { resolveAppRequestPath } = await import('./app-protocol')

const root = path.resolve('/opt/retenia/out/renderer')

describe('resolveAppRequestPath', () => {
  it('serves a real asset', () => {
    expect(resolveAppRequestPath(root, 'app://retenia/assets/index-abc.js')).toBe(
      path.join(root, 'assets/index-abc.js'),
    )
  })

  it.each([
    ['the root', 'app://retenia/'],
    ['a client-side route', 'app://retenia/paths/123'],
    ['a nested route', 'app://retenia/review/session/abc'],
  ])('falls back to the SPA shell for %s', (_label, url) => {
    expect(resolveAppRequestPath(root, url)).toBe(path.join(root, 'index.html'))
  })

  it('ignores the query string and hash', () => {
    expect(resolveAppRequestPath(root, 'app://retenia/index.html?a=1#b')).toBe(
      path.join(root, 'index.html'),
    )
  })

  it('decodes a segment that is merely escaped', () => {
    expect(resolveAppRequestPath(root, 'app://retenia/assets/a%20b.css')).toBe(
      path.join(root, 'assets/a b.css'),
    )
  })

  it.each([
    ['percent-encoded traversal', 'app://retenia/%2e%2e%2f%2e%2e%2fetc%2fpasswd'],
    ['an encoded separator mid-segment', 'app://retenia/assets%2f..%2f..%2f..%2fetc%2fpasswd'],
    ['an encoded backslash, which Windows treats as a separator', 'app://retenia/a%5c..%5cb.js'],
    ['a null byte', 'app://retenia/index.html%00.png'],
    ['a malformed escape', 'app://retenia/%zz.js'],
    ['a url it cannot parse', 'not a url'],
  ])('refuses %s', (_label, url) => {
    expect(resolveAppRequestPath(root, url)).toBeNull()
  })

  it.each([
    'app://retenia/../../../etc/passwd',
    'app://retenia/assets/../../../../etc/passwd',
    'app://retenia/../renderer-evil/index.html',
    // The parser decodes and collapses `%2e%2e` too, so this is not a traversal either.
    'app://retenia/%2e%2e/secret.txt',
  ])('never escapes the root for %s', (url) => {
    // The URL parser collapses `../` before this function runs, so these do not reach
    // outside the root at all — they just resolve to something that is not there.
    const resolved = resolveAppRequestPath(root, url)
    expect(resolved).not.toBeNull()
    expect(path.relative(root, resolved as string).startsWith('..')).toBe(false)
  })
})
