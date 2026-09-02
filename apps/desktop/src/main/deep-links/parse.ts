import type { DeepLink } from '@retenia/ipc-contract'

export const DEEP_LINK_PROTOCOL = 'retenia'

/**
 * Deep links are a fully untrusted, remotely-triggerable input: `app.setAsDefaultProtocolClient`
 * makes `retenia://…` invocable from any web page the user visits, not just from inside the
 * app. Constraining `import`'s `src` to http(s) here — rather than accepting any string — keeps
 * a crafted link from smuggling a local path, a UNC share, or a `javascript:`/`data:` URL into
 * whatever eventually consumes it (the ingestion pipeline, sub-phase 6.x).
 */
const ALLOWED_IMPORT_PROTOCOLS = new Set(['https:', 'http:'])

/**
 * Parses and validates an `import` deep link's `src`, returning the parsed `URL` — never
 * the raw string — so whatever gets forwarded is exactly what was validated. Forwarding
 * the raw query value instead would let it diverge from what was checked: the WHATWG URL
 * parser lowercases the scheme, tolerates a missing slash (`https:example.com`), and
 * strips embedded tab/CR/LF, none of which a downstream consumer doing anything less than
 * a full re-parse (a prefix check, a regex, string-splitting) can be relied on to agree
 * with — including `packages/ipc-contract`'s own schema check on this same field.
 */
function parseImportSrc(value: string): URL | null {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  return ALLOWED_IMPORT_PROTOCOLS.has(parsed.protocol) ? parsed : null
}

/**
 * Parse a `retenia://…` URL into a typed {@link DeepLink}, or `null` if it is not one of
 * the shapes the app understands.
 *
 * `new URL()` treats everything after `scheme://` up to the next `/`, `?` or `#` as the
 * host, which is exactly the "kind" segment here (`import`, `review`, `auth`) — `auth`
 * additionally carries a `/callback` path for the future OAuth flow.
 */
export function parseDeepLink(rawUrl: string): DeepLink | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  if (url.protocol !== `${DEEP_LINK_PROTOCOL}:`) {
    return null
  }

  // A trailing slash (`retenia://review/`) means the same thing as none.
  const pathname = url.pathname.replace(/\/+$/, '')

  switch (url.host) {
    case 'import': {
      const src = url.searchParams.get('src')
      const parsedSrc = src ? parseImportSrc(src) : null
      return parsedSrc ? { kind: 'import', src: parsedSrc.href } : null
    }

    case 'review':
      return pathname === '' ? { kind: 'review' } : null

    case 'auth':
      return pathname === '/callback'
        ? { kind: 'authCallback', params: Object.fromEntries(url.searchParams) }
        : null

    default:
      return null
  }
}
