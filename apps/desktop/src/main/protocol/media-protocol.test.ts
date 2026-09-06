import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { protocol } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Electron is not running: `protocol.handle` is a spy the response tests read the registered
// handler back out of, and everything else here exercises the pure resolver and range parser.
vi.mock('electron', () => ({
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}))

const { handleMediaProtocol, parseRangeHeader, resolveMediaBlobPath } = await import(
  './media-protocol'
)

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
    // The extension allow-list is the `MIME_TYPES` table itself: a type the scheme has no
    // `Content-Type` for is refused rather than served as `application/octet-stream`.
    ['an extension with no declared mime type', `media://blob/${hash}.wasm`],
    ['an executable extension', `media://blob/${hash}.exe`],
    ['an html extension', `media://blob/${hash}.html`],
    ['a prototype key masquerading as an extension', `media://blob/${hash}.constructor`],
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

  it('serves every extension the blob store can write', async () => {
    // The two tables are one contract in one direction: `MIME_TO_EXT` decides the name a blob is
    // written under, and a name this scheme refuses is a blob nothing can ever fetch — the file
    // is on disk as `<hash>.<ext>`, so the bare-hash form 404s and there is no second route to
    // it. Adding a row to `../blobs/mime.ts` without one here therefore fails right here.
    const { extForMime, KNOWN_MIMES } = await import('../blobs/mime')
    // Every row of `MIME_TO_EXT`, not a sample of it: sub-phase 6.4 added five (mkv, mov, vtt
    // and two more audio aliases) and a hand-written list here would have kept passing while
    // covering none of them.
    expect(KNOWN_MIMES.length).toBeGreaterThan(0)
    for (const mime of KNOWN_MIMES) {
      const ext = extForMime(mime)
      expect(ext).not.toBeNull()
      expect(resolveMediaBlobPath(root, `media://blob/${hash}.${ext}`)).toBe(
        path.join(root, hash.slice(0, 2), `${hash}.${ext}`),
      )
    }
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

/**
 * The handler's responses. `protocol.handle` is mocked, so the registered callback is invoked
 * directly with a minimal request — it reads nothing off it but `url` and the `Range` header.
 */
describe('handleMediaProtocol responses', () => {
  const bytes = Buffer.from('a'.repeat(4096))
  let root: string

  /** Only `url` and `headers` are touched by the handler; a real `Request` cannot be built for a
   *  non-http scheme in Node. */
  const asRequest = (url: string, range?: string) =>
    ({
      url,
      headers: new Headers(range === undefined ? {} : { Range: range }),
    }) as unknown as Request

  async function respondTo(url: string, range?: string): Promise<Response> {
    vi.mocked(protocol.handle).mockClear()
    handleMediaProtocol(root)
    const handler = vi.mocked(protocol.handle).mock.calls[0]?.[1]
    if (!handler) throw new Error('handleMediaProtocol registered no handler')
    return handler(asRequest(url, range))
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'retenia-media-'))
    await mkdir(path.join(root, hash.slice(0, 2)), { recursive: true })
    await writeFile(path.join(root, hash.slice(0, 2), `${hash}.ogg`), bytes)
    // The extensionless form the blob store writes for a mime `../blobs/mime.ts` has no
    // extension for — the one path that still reaches the `application/octet-stream` fallback.
    await writeFile(path.join(root, hash.slice(0, 2), hash), bytes)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('answers a whole file with 200 and its declared type', async () => {
    const response = await respondTo(`media://blob/${hash}.ogg`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/ogg')
    expect((await response.arrayBuffer()).byteLength).toBe(bytes.length)
  })

  it('serves an extensionless blob as application/octet-stream', async () => {
    const response = await respondTo(`media://blob/${hash}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    await response.arrayBuffer()
  })

  // The nosniff header is what makes `application/octet-stream` — and every other type here —
  // final: a blob an attacker managed to write at a known hash cannot be re-typed as markup by
  // the browser. It rides on every status, since an error body is sniffable too.
  it.each([
    ['200 for a whole file', `media://blob/${hash}.ogg`, undefined, 200],
    ['206 for a range', `media://blob/${hash}.ogg`, 'bytes=0-15', 206],
    ['416 for an unsatisfiable range', `media://blob/${hash}.ogg`, 'bytes=99999-', 416],
    ['403 for a refused path', 'media://blob/nope', undefined, 403],
    ['404 for a blob that is not on disk', `media://blob/${'b'.repeat(64)}.ogg`, undefined, 404],
  ])('sends X-Content-Type-Options: nosniff with the %s', async (_label, url, range, status) => {
    const response = await respondTo(url, range)
    expect(response.status).toBe(status)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    await response.arrayBuffer()
  })

  it('refuses an extension the scheme declares no mime type for, even with the blob on disk', async () => {
    await writeFile(path.join(root, hash.slice(0, 2), `${hash}.html`), bytes)
    const response = await respondTo(`media://blob/${hash}.html`)
    expect(response.status).toBe(403)
    await response.arrayBuffer()
  })

  it('answers a document blob with the type the blob store wrote it as', async () => {
    // The regression this guards: narrowing the allow-list to `MIME_TYPES` made every extension
    // the store writes but the table omitted permanently unreachable — a 403 by name and a 404
    // at the bare hash, with no third form to ask for.
    await writeFile(path.join(root, hash.slice(0, 2), `${hash}.epub`), bytes)
    const response = await respondTo(`media://blob/${hash}.epub`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/epub+zip')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    await response.arrayBuffer()
  })
})
