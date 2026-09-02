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

describe('resolveAppRequestPath under Windows path rules', () => {
  // Win32 strips trailing dots and spaces from a path component, so `".. "` opens the
  // parent directory even though `path.relative` sees an ordinary directory name. These
  // run against `path.win32` explicitly so Linux CI covers the primary target platform.
  const winRoot = 'C:\\Program Files\\Retenia\\resources\\app.asar\\out\\renderer'

  it.each([
    ['a trailing-space dot-dot', 'app://retenia/assets/..%20/..%20/..%20/Windows/win.ini'],
    ['one buried in a longer path', 'app://retenia/a/..%20/..%20/package.json'],
    ['a single prefixed segment, which a leading-".." check misses', 'app://retenia/a/..%20/b.js'],
    ['three dots', 'app://retenia/a/...%2fb.js'],
    ['a dot-space-dot component', 'app://retenia/a/.%20./b.js'],
    ['a lone dot with a space', 'app://retenia/a/.%20/b.js'],
    ['a tab-padded dot-dot', 'app://retenia/a/..%09/b.js'],
  ])('refuses %s', (_label, url) => {
    expect(resolveAppRequestPath(winRoot, url, path.win32)).toBeNull()
  })

  it('refuses a drive-relative first segment', () => {
    expect(resolveAppRequestPath(winRoot, 'app://retenia/C%3a%2fbar.js', path.win32)).toBeNull()
  })

  it('still serves an ordinary Windows asset', () => {
    expect(resolveAppRequestPath(winRoot, 'app://retenia/assets/index-abc.js', path.win32)).toBe(
      `${winRoot}\\assets\\index-abc.js`,
    )
  })

  it('never resolves outside the root for any of the traversal shapes', () => {
    const attempts = [
      'app://retenia/assets/..%20/..%20/..%20/Windows/win.ini',
      'app://retenia/a/..%20/b.js',
      'app://retenia/C%3a%2fbar.js',
      'app://retenia/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    ]
    for (const url of attempts) {
      const resolved = resolveAppRequestPath(winRoot, url, path.win32)
      if (resolved !== null) {
        expect(path.win32.relative(winRoot, resolved).startsWith('..')).toBe(false)
      }
    }
  })
})
