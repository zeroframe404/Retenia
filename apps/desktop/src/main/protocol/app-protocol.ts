import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { type CustomScheme, net, protocol } from 'electron'
import { buildCsp } from '../security/csp'
import { APP_HOST, APP_SCHEME } from '../security/origins'

/**
 * The renderer is served from `app://retenia/` rather than `file://` so it gets a real,
 * secure origin: `'self'` in the CSP means something, `event.senderFrame` can be checked
 * against a single origin, and the renderer is not granted the ambient reach of `file://`
 * (docs/spec/07-architecture.md §4).
 *
 * Only the privilege descriptor is exported, not a `register*Scheme()` call: Electron writes
 * scheme privileges to renderer command-line switches by *overwrite*, not append, so calling
 * `protocol.registerSchemesAsPrivileged` more than once silently drops privileges from every
 * scheme but the last one registered. `media://` must be registered in the same call — see
 * `registerPrivilegedSchemes` in `../index.ts`.
 */
export const APP_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: APP_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
    // The renderer must obey the CSP we inject, not be exempt from it.
    bypassCSP: false,
  },
}

/**
 * Win32 strips trailing dots and spaces from every path component before opening it, so
 * `".. "`, `"..."` and `". ."` all address the parent directory even though Node's `path`
 * treats them as ordinary names. Any component made only of dots and whitespace is refused.
 */
const DOTS_AND_SPACE_ONLY = /^[.\s]+$/

/**
 * Map a request URL onto a file inside `root`, or `null` if it escapes.
 *
 * Each path segment is decoded on its own and then checked, rather than decoding the whole
 * pathname at once: the URL parser collapses `../` before we ever see it, so the traversal
 * that matters is the one hiding inside an *encoded* segment (`%2e%2e%2f`), which only
 * becomes a separator after decoding.
 *
 * `pathApi` is injectable so the Windows rules above can be tested on any platform; it is
 * never passed in production.
 */
export function resolveAppRequestPath(
  root: string,
  requestUrl: string,
  pathApi: path.PlatformPath = path,
): string | null {
  let pathname: string
  try {
    pathname = new URL(requestUrl).pathname
  } catch {
    return null
  }

  const segments: string[] = []
  for (const rawSegment of pathname.split('/')) {
    if (rawSegment === '') {
      continue
    }

    let segment: string
    try {
      segment = decodeURIComponent(rawSegment)
    } catch {
      return null
    }

    if (
      DOTS_AND_SPACE_ONLY.test(segment) ||
      segment.includes('/') ||
      segment.includes('\\') ||
      segment.includes('\0')
    ) {
      return null
    }

    segments.push(segment)
  }

  // A path with no extension is a client-side route: the SPA shell answers it.
  const last = segments.at(-1)
  const relative = last && pathApi.extname(last) ? segments.join('/') : 'index.html'

  const resolvedRoot = pathApi.resolve(root)
  const resolved = pathApi.resolve(resolvedRoot, relative)

  // Backstop for anything the segment rules miss — a Win32 drive-relative first segment
  // (`C:/…`) is the one that gets here. `path.relative` rather than a string prefix, so a
  // sibling directory sharing the root's name prefix cannot pass.
  const inside = pathApi.relative(resolvedRoot, resolved)
  if (inside === '' || inside.startsWith('..') || pathApi.isAbsolute(inside)) {
    return null
  }

  return resolved
}

/**
 * Serve the built renderer over `app://`.
 *
 * The CSP is set on the response here *as well as* in `onHeadersReceived`: whether
 * `webRequest` observes custom schemes is an implementation detail of Chromium's network
 * stack, and the production policy is not worth betting on it.
 *
 * `getCsp` is a function, not a precomputed string, so the policy is read fresh on every
 * request rather than frozen into this closure at startup — the provider allowlist it is
 * built from is meant to come from settings (sub-phase 7.x), which can change without a
 * relaunch.
 */
export function handleAppProtocol(rendererRoot: string, getCsp: () => string = buildCsp): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)

    if (url.host !== APP_HOST) {
      return new Response('Not found', { status: 404 })
    }

    const filePath = resolveAppRequestPath(rendererRoot, request.url)
    if (!filePath) {
      return new Response('Forbidden', { status: 403 })
    }

    let response: Response
    try {
      // `net.fetch` over `file://` gives us Range support for free (needed for media in 1.3).
      response = await net.fetch(pathToFileURL(filePath).toString())
    } catch {
      // A missing file rejects; without this the request fails with an opaque network
      // error and every stale asset URL logs a main-process exception.
      return new Response('Not found', { status: 404 })
    }

    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', getCsp())
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  })
}
