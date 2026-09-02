import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// Only the pure resolver and range parser are under test here; Electron is not running.
vi.mock('electron', () => ({
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}))

const { parseRangeHeader, resolveMediaBlobPath } = await import('./media-protocol')

const root = path.resolve('/opt/retenia/userData/blobs')
const hash = '98da58fb5dce13a659f9f7824e48eb22007740a4622174cde039080139bcaae9'

describe('resolveMediaBlobPath', () => {
  it('maps a bare hash to <root>/<aa>/<hash>', () => {
    expect(resolveMediaBlobPath(root, `media://blob/${hash}`)).toBe(
      path.join(root, hash.slice(0, 2), hash),
    )
  })

  it('maps a hash with an extension to <root>/<aa>/<hash>.<ext>', () => {
    expect(resolveMediaBlobPath(root, `media://blob/${hash}.ogg`)).toBe(
      path.join(root, hash.slice(0, 2), `${hash}.ogg`),
    )
  })

  it('lowercases an uppercase hash and extension', () => {
    expect(resolveMediaBlobPath(root, `media://blob/${hash.toUpperCase()}.OGG`)).toBe(
      path.join(root, hash.slice(0, 2), `${hash}.ogg`),
    )
  })

  it.each([
    ['a different host', `media://thumb/${hash}`],
    ['too short to be a sha256', 'media://blob/abc123'],
    ['too long to be a sha256', `media://blob/${hash}ab`],
    ['non-hex characters', `media://blob/${'g'.repeat(64)}`],
    ['an empty path', 'media://blob/'],
    ['more than one path segment', `media://blob/${hash}/extra`],
    ['an extension with a dot in it', `media://blob/${hash}.tar.gz`],
    ['an extension that is too long', `media://blob/${hash}.${'a'.repeat(20)}`],
    ['a url it cannot parse', 'not a url'],
  ])('refuses %s', (_label, url) => {
    expect(resolveMediaBlobPath(root, url)).toBeNull()
  })

  it.each([
    ['literal traversal segments', `media://blob/..%2f..%2f..%2fetc%2fpasswd`],
    [
      'an encoded slash inside the hash position',
      `media://blob/${hash.slice(0, 32)}%2f${hash.slice(32)}`,
    ],
    ['an encoded backslash', `media://blob/${hash.slice(0, 32)}%5c${hash.slice(32)}`],
    ['a null byte', `media://blob/${hash}%00.ogg`],
    ['an absolute unix path as the hash', 'media://blob/%2Fetc%2Fpasswd'],
    ['a windows drive-relative path as the hash', 'media://blob/C%3A%2Fwindows%2Fwin.ini'],
    ['a malformed escape', 'media://blob/%zz'],
    ['dot-dot as the extension', `media://blob/${hash}..`],
  ])('fails closed on %s (traversal attempt)', (_label, url) => {
    expect(resolveMediaBlobPath(root, url)).toBeNull()
  })

  it('never resolves outside the root, even if the regex is ever loosened', () => {
    // Defence in depth: even a hash-shaped segment that somehow encoded '..' components
    // must not escape `root`. This exercises the `path.relative` backstop directly.
    const resolved = resolveMediaBlobPath(root, `media://blob/${hash}`, path.win32)
    if (resolved !== null) {
      expect(path.win32.relative(root, resolved).startsWith('..')).toBe(false)
    }
  })
})

describe('parseRangeHeader', () => {
  const totalSize = 1000

  it('treats a missing header as no range', () => {
    expect(parseRangeHeader(null, totalSize)).toEqual({ kind: 'none' })
  })

  it('resolves a plain start-end range', () => {
    expect(parseRangeHeader('bytes=0-99', totalSize)).toEqual({
      kind: 'satisfiable',
      start: 0,
      end: 99,
    })
  })

  it('resolves an open-ended range to the end of the file', () => {
    expect(parseRangeHeader('bytes=500-', totalSize)).toEqual({
      kind: 'satisfiable',
      start: 500,
      end: 999,
    })
  })

  it('resolves a suffix range to the last N bytes', () => {
    expect(parseRangeHeader('bytes=-100', totalSize)).toEqual({
      kind: 'satisfiable',
      start: 900,
      end: 999,
    })
  })

  it('clamps an end past the end of the file rather than rejecting it', () => {
    expect(parseRangeHeader('bytes=900-999999', totalSize)).toEqual({
      kind: 'satisfiable',
      start: 900,
      end: 999,
    })
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseRangeHeader('  bytes=0-9  ', totalSize)).toEqual({
      kind: 'satisfiable',
      start: 0,
      end: 9,
    })
  })

  it('is unsatisfiable when the start is at or past the end of the file', () => {
    expect(parseRangeHeader('bytes=1000-', totalSize)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRangeHeader('bytes=5000-6000', totalSize)).toEqual({ kind: 'unsatisfiable' })
  })

  it('is unsatisfiable against an empty file', () => {
    expect(parseRangeHeader('bytes=0-0', 0)).toEqual({ kind: 'unsatisfiable' })
  })

  it.each([
    ['a multi-range request', 'bytes=0-10,20-30'],
    ['a unit other than bytes', 'items=0-10'],
    ['an end before the start', 'bytes=100-50'],
    ['a negative start', 'bytes=-5-10'],
    ['a suffix of zero', 'bytes=-0'],
    ['no numbers at all', 'bytes=-'],
    ['garbage', 'not a range'],
    ['an empty string', ''],
  ])('falls back to "no range" (serve the whole file) on %s', (_label, header) => {
    expect(parseRangeHeader(header, totalSize)).toEqual({ kind: 'none' })
  })
})
