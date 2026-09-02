import { originOf } from './origins'

/**
 * Origins the renderer may open network connections to, beyond its own.
 *
 * A constant for now; sub-phase 7.x replaces the caller's argument with the list read from
 * settings, which is why `buildCsp` takes it as a parameter instead of reaching for this
 * constant itself.
 */
export const PROVIDER_ORIGINS: readonly string[] = Object.freeze([
  'https://api.anthropic.com',
  'https://generativelanguage.googleapis.com',
  'https://*.speech.microsoft.com',
  'https://api.elevenlabs.io',
  'https://openrouter.ai',
])

/** Local inference servers: Ollama and LM Studio (docs/spec/07-architecture.md §4). */
export const LOCAL_AI_ORIGINS: readonly string[] = Object.freeze([
  'http://127.0.0.1:11434',
  'http://127.0.0.1:1234',
])

export interface CspOptions {
  /**
   * Relax the policy for the Vite dev server: `@vitejs/plugin-react` injects an inline
   * preamble and HMR needs a websocket, neither of which the production policy permits.
   * Never true in a packaged build.
   */
  isDev?: boolean
  /** The dev server URL, so HMR's `http:`/`ws:` origins can be allowed in `connect-src`. */
  devServerUrl?: string
  providerOrigins?: readonly string[]
}

/**
 * Build the `Content-Security-Policy` header value.
 *
 * `object-src`, `base-uri`, `form-action` and `frame-ancestors` are spelled out because
 * they do not fall back to `default-src` — leaving them off would leave real gaps behind an
 * otherwise strict policy.
 */
export function buildCsp(options: CspOptions = {}): string {
  const { isDev = false, devServerUrl, providerOrigins = PROVIDER_ORIGINS } = options

  const scriptSrc = ["'self'", "'wasm-unsafe-eval'"]
  const connectSrc = ["'self'", ...LOCAL_AI_ORIGINS, ...providerOrigins]

  if (isDev) {
    // The React Fast Refresh preamble is an inline script, and HMR talks over a websocket.
    scriptSrc.push("'unsafe-inline'")
    const devOrigin = devServerUrl ? originOf(devServerUrl) : null
    if (devOrigin) {
      connectSrc.push(devOrigin, devOrigin.replace(/^http/, 'ws'))
    }
  }

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' media: data: blob:",
    'media-src media: blob:',
    `connect-src ${connectSrc.join(' ')}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}
