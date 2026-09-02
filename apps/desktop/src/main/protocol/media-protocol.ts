import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { type CustomScheme, protocol } from 'electron'

export const MEDIA_SCHEME = 'media'
/** `media://blob/<sha256>[.ext]` — the only namespace this phase serves. */
export const MEDIA_BLOB_HOST = 'blob'

/**
 * `media://` needs `stream: true` (Range support) on top of the same privileges as
 * `app://`; it is registered as its own scheme rather than a path under `app://` so the
 * two can carry different privileges and content policies.
 *
 * `corsEnabled: true` is required, not optional: the renderer is served from `app://`, so
 * a `fetch()` against `media://` is cross-origin, and Chromium enforces CORS for a
 * `standard` custom scheme at the privilege level — without it, `fetch()` rejects with a
 * generic "Failed to fetch" before the request ever reaches `protocol.handle`. An
 * `<audio>`/`<video>` element is unaffected either way, since a media element's request
 * runs in `no-cors` mode.
 *
 * Only the privilege descriptor is exported — see the comment on `APP_SCHEME_PRIVILEGES`
 * in `./app-protocol.ts` for why this scheme must be registered in the same
 * `protocol.registerSchemesAsPrivileged` call as `app://` rather than its own.
 */
export const MEDIA_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: MEDIA_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
    bypassCSP: false,
  },
}

/** A sha256 hex digest, lowercase or uppercase — nothing else matches this. */
const SHA256_HEX = /^[0-9a-f]{64}$/i
/** A conservative allowlist for the optional extension: no dots, slashes or spaces. */
const EXT_PATTERN = /^[a-zA-Z0-9]{1,16}$/

/**
 * Map `media://blob/<sha256>[.ext]` onto `<root>/<sha256[0:2]>/<sha256>[.ext]`, or `null`
 * if the request is not that shape.
 *
 * Unlike the `app://` resolver, this one does not need a Windows-specific traversal
 * defense: the sha256 segment must be exactly 64 hex characters, so `..`, an encoded
 * separator, a drive letter or a null byte all fail the regex before any path arithmetic
 * happens. The final `path.relative` check is kept anyway as a backstop, in case a future
 * change loosens the pattern.
 */
export function resolveMediaBlobPath(
  root: string,
  requestUrl: string,
  pathApi: path.PlatformPath = path,
): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }

  if (url.host !== MEDIA_BLOB_HOST) {
    return null
  }

  const segments = url.pathname.split('/').filter((segment) => segment !== '')
  if (segments.length !== 1) {
    return null
  }

  let segment: string
  try {
    segment = decodeURIComponent(segments[0] as string)
  } catch {
    return null
  }

  const dotIndex = segment.indexOf('.')
  const hash = dotIndex === -1 ? segment : segment.slice(0, dotIndex)
  const ext = dotIndex === -1 ? null : segment.slice(dotIndex + 1)

  if (!SHA256_HEX.test(hash)) {
    return null
  }
  if (ext !== null && !EXT_PATTERN.test(ext)) {
    return null
  }

  const lowerHash = hash.toLowerCase()
  const filename = ext ? `${lowerHash}.${ext.toLowerCase()}` : lowerHash

  const resolvedRoot = pathApi.resolve(root)
  const resolved = pathApi.resolve(resolvedRoot, lowerHash.slice(0, 2), filename)

  const inside = pathApi.relative(resolvedRoot, resolved)
  if (inside === '' || inside.startsWith('..') || pathApi.isAbsolute(inside)) {
    return null
  }

  return resolved
}

const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
})

function mimeTypeFor(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return MIME_TYPES[ext] ?? 'application/octet-stream'
}

export type RangeParseResult =
  | { kind: 'none' }
  | { kind: 'satisfiable'; start: number; end: number }
  | { kind: 'unsatisfiable' }

/**
 * Parse a single-range `Range: bytes=<start>-<end>` request header against a known
 * `totalSize`. Multi-range requests (`bytes=0-10,20-30`) and anything malformed are treated
 * as `'none'` — no `Range`, serve the whole file — rather than rejected outright, since a
 * client that sends a header we cannot honor is still owed a response. `'unsatisfiable'` is
 * reserved for the one case RFC 7233 actually calls for a 416: a range starting at or past
 * the end of the file.
 */
export function parseRangeHeader(header: string | null, totalSize: number): RangeParseResult {
  if (!header) {
    return { kind: 'none' }
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (match[1] === '' && match[2] === '')) {
    return { kind: 'none' }
  }

  const [, startStr, endStr] = match
  let start: number
  let end: number

  if (startStr === '') {
    // A suffix range (`bytes=-500`): the last N bytes. `start` is clamped into range by
    // construction, so only the unsatisfiable check at the end can still reject it (an
    // empty file).
    const suffixLength = Number(endStr)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { kind: 'none' }
    }
    start = Math.max(0, totalSize - suffixLength)
    end = totalSize - 1
  } else {
    start = Number(startStr)
    if (!Number.isInteger(start) || start < 0) {
      return { kind: 'none' }
    }
    // Checked before `end` is even parsed: a start past the end of the file is
    // unsatisfiable regardless of what `end` says, and `totalSize - 1` below would
    // otherwise make it look like a malformed "end before start" range instead.
    if (start >= totalSize) {
      return { kind: 'unsatisfiable' }
    }
    end = endStr === '' ? totalSize - 1 : Number(endStr)
    if (!Number.isInteger(end) || end < start) {
      return { kind: 'none' }
    }
  }

  if (totalSize === 0 || start >= totalSize) {
    return { kind: 'unsatisfiable' }
  }

  return { kind: 'satisfiable', start, end: Math.min(end, totalSize - 1) }
}

/**
 * Serve blobs from `blobsRoot` over `media://`, implementing Range ourselves with
 * `fs.createReadStream({ start, end })` rather than delegating to `net.fetch`: against a
 * `file://` URL, `net.fetch` in this Electron version does slice the body to match an
 * incoming `Range` header, but it answers `200` with no `Content-Range` — which is not
 * enough for a `<video>`/`<audio>` element (or a test) to tell a partial response from a
 * full one, and is what seeking actually depends on.
 */
export function handleMediaProtocol(blobsRoot: string): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const filePath = resolveMediaBlobPath(blobsRoot, request.url)
    if (!filePath) {
      return new Response('Forbidden', { status: 403 })
    }

    let totalSize: number
    try {
      totalSize = (await stat(filePath)).size
    } catch {
      return new Response('Not found', { status: 404 })
    }

    const range = parseRangeHeader(request.headers.get('range'), totalSize)

    if (range.kind === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${totalSize}`, 'Accept-Ranges': 'bytes' },
      })
    }

    const { start, end } = range.kind === 'satisfiable' ? range : { start: 0, end: totalSize - 1 }
    const length = totalSize === 0 ? 0 : end - start + 1

    const nodeStream =
      totalSize === 0 ? Readable.from([]) : createReadStream(filePath, { start, end })
    const body = Readable.toWeb(nodeStream) as unknown as ReadableStream

    const headers = new Headers({
      'Content-Type': mimeTypeFor(filePath),
      'Content-Length': String(length),
      'Accept-Ranges': 'bytes',
    })
    if (range.kind === 'satisfiable') {
      headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`)
    }

    return new Response(body, { status: range.kind === 'satisfiable' ? 206 : 200, headers })
  })
}
