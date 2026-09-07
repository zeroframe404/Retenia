import type { DeepLink } from '@retenia/ipc-contract'
import { z } from 'zod'

export const DEEP_LINK_PROTOCOL = 'retenia'

/**
 * Deep links are a fully untrusted, remotely-triggerable input: `app.setAsDefaultProtocolClient`
 * makes `retenia://…` invocable from any web page the user visits, not just from inside the
 * app. Constraining `import`'s `src` to http(s) here — rather than accepting any string — keeps
 * a crafted link from smuggling a local path, a UNC share, or a `javascript:`/`data:` URL into
 * whatever eventually consumes it (the ingestion pipeline, sub-phase 6.x).
 */
const ALLOWED_IMPORT_PROTOCOLS = new Set(['https:', 'http:'])

function isAllowedImportSrc(value: string): boolean {
  try {
    return ALLOWED_IMPORT_PROTOCOLS.has(new URL(value).protocol)
  } catch {
    return false
  }
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
      return src && isAllowedImportSrc(src) ? { kind: 'import', src } : null
    }

    case 'review':
      return pathname === '' ? { kind: 'review' } : null

    case 'auth':
      return pathname === '/callback'
        ? { kind: 'authCallback', params: Object.fromEntries(url.searchParams) }
        : null

    case 'source': {
      // `retenia://source/<id>?page=12` or `?cfi=epubcfi(...)` — "ver en la fuente" from a
      // card made from a highlight (sub-phase 6.6). `pathname` is `/<id>` (the leading slash
      // `new URL` keeps after the host), so the id is everything after it. A malformed
      // `page`/`cfi` rejects the whole link rather than silently dropping it, the same
      // strictness `import`'s `src` gets above.
      const id = pathname.startsWith('/') ? pathname.slice(1) : ''
      if (!z.uuid().safeParse(id).success) return null

      const pageParam = url.searchParams.get('page')
      let page: number | undefined
      if (pageParam !== null) {
        const parsed = Number.parseInt(pageParam, 10)
        if (!Number.isInteger(parsed) || parsed <= 0) return null
        page = parsed
      }

      const cfi = url.searchParams.get('cfi')
      if (cfi !== null && cfi.length === 0) return null

      return {
        kind: 'source',
        id,
        ...(page === undefined ? {} : { page }),
        ...(cfi === null ? {} : { cfi }),
      }
    }

    default:
      return null
  }
}
