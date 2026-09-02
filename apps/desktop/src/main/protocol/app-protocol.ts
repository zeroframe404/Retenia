import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { buildCsp } from '../security/csp'
import { APP_HOST, APP_SCHEME } from '../security/origins'

/**
 * The renderer is served from `app://retenia/` rather than `file://` so it gets a real,
 * secure origin: `'self'` in the CSP means something, `event.senderFrame` can be checked
 * against a single origin, and the renderer is not granted the ambient reach of `file://`
 * (docs/spec/07-architecture.md §4). `media://` and deep links land in sub-phase 1.3.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
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
    },
  ])
}

/**
 * Map a request URL onto a file inside `root`, or `null` if it escapes.
 *
 * Each path segment is decoded on its own and then checked, rather than decoding the whole
 * pathname at once: the URL parser collapses `../` before we ever see it, so the traversal
 * that matters is the one hiding inside an *encoded* segment (`%2e%2e%2f`), which only
 * becomes a separator after decoding. A segment that decodes into a separator, a `..`, or a
 * null byte is refused outright.
 */
export function resolveAppRequestPath(root: string, requestUrl: string): string | null {
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
      segment === '.' ||
      segment === '..' ||
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
  const relative = last && path.extname(last) ? segments.join('/') : 'index.html'

  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, relative)

  // Belt and braces: the segment checks above already make an escape impossible, but the
  // cost of proving it here is one string comparison. `path.relative` rather than a string
  // prefix, so a sibling directory sharing the root's name prefix cannot pass.
  const inside = path.relative(resolvedRoot, resolved)
  if (inside.startsWith('..') || path.isAbsolute(inside)) {
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
 */
export function handleAppProtocol(rendererRoot: string, csp: string = buildCsp()): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)

    if (url.host !== APP_HOST) {
      return new Response('Not found', { status: 404 })
    }

    const filePath = resolveAppRequestPath(rendererRoot, request.url)
    if (!filePath) {
      return new Response('Forbidden', { status: 403 })
    }

    const response = await net.fetch(pathToFileURL(filePath).toString())
    // `net.fetch` over `file://` gives us Range support for free (needed for media in 1.3).
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', csp)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  })
}
