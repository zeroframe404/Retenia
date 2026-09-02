/**
 * The single origin the renderer is allowed to run at, and the check every IPC handler
 * applies to `event.senderFrame` (docs/spec/07-architecture.md §4).
 */

export const APP_SCHEME = 'app'
export const APP_HOST = 'retenia'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`
export const APP_INDEX_URL = `${APP_ORIGIN}/index.html`

/**
 * `URL.origin` is `'null'` for every non-special scheme, `app://` included, so it cannot be
 * used to compare origins here. Scheme + host is the equivalent comparison for a scheme
 * registered as `standard`.
 */
export function originOf(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!parsed.host) {
    // `file:///…`, `about:blank`, `data:…`: no host, so no origin worth trusting.
    return null
  }
  return `${parsed.protocol}//${parsed.host}`
}

/** True when `url` is served from one of `allowed`. Anything unparseable is rejected. */
export function isAllowedSenderUrl(
  url: string | null | undefined,
  allowed: readonly string[],
): boolean {
  if (!url) {
    return false
  }
  const origin = originOf(url)
  return origin !== null && allowed.includes(origin)
}

/**
 * In production the renderer is only ever served from `app://retenia`. In development it
 * comes from the Vite dev server, whose origin has to be trusted as well — hence the
 * explicit dev switch rather than a wildcard.
 */
export function allowedRendererOrigins(devServerUrl?: string): readonly string[] {
  const origins = [APP_ORIGIN]
  if (devServerUrl) {
    const devOrigin = originOf(devServerUrl)
    if (devOrigin) {
      origins.push(devOrigin)
    }
  }
  return origins
}
