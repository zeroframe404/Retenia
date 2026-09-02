import type { DeepLink } from '@retenia/ipc-contract'

export const DEEP_LINK_PROTOCOL = 'retenia'

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
      return src ? { kind: 'import', src } : null
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
