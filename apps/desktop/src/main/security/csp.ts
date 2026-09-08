import { originOf } from './origins'

/**
 * Origins the renderer may open network connections to, beyond its own. **Empty.**
 *
 * `connect-src` is a *document* policy that Blink enforces on the renderer. Main's
 * `net.fetch` never consults it — and since sub-phase 7.1 every provider call runs in main,
 * where the API keys are. Listing provider origins here granted an outbound reach to the
 * one process that renders untrusted content (PDFs, EPUBs, scraped pages, pasted HTML) and
 * that no feature has ever used. A capability nothing needs is only an exit.
 *
 * `buildCsp` still takes the list as a parameter, because sub-phase 11.2 has a real case
 * for exactly one entry: the Azure Speech SDK assesses pronunciation from the renderer, so
 * it can hold the microphone stream. That will be argued then, for that origin.
 *
 * `ai.providers.allowlist` is deliberately **not** wired to this. It says which profiles
 * *main* may call; feeding a main-side egress policy into the renderer's document policy
 * would mean a user adding a provider silently widened the renderer's reach.
 */
export const RENDERER_PROVIDER_ORIGINS: readonly string[] = Object.freeze([])

/**
 * Local inference servers: Ollama and LM Studio (docs/spec/07-architecture.md §4).
 *
 * Exported for sub-phase 7.4, which reaches them — from **main** and the embedding utility
 * process (`main/library/embedding-service.ts`, `worker/embedding-host.ts`), never from the
 * renderer, which is why they are no longer in `connect-src` either.
 *
 * A note for 7.4, since the obvious helper is the wrong one: main's own egress check must
 * reuse `library/url-safety.ts`'s private-range logic **with loopback allowed** — Ollama and
 * LM Studio *are* loopback. `assertPublicHttpUrl` refuses loopback and would reject both.
 */
export const LOCAL_AI_ORIGINS: readonly string[] = Object.freeze([
  'http://127.0.0.1:11434',
  'http://127.0.0.1:1234',
])

export interface CspOptions {
  /**
   * The Vite dev server URL, when one is serving the renderer.
   *
   * Its presence — not `app.isPackaged` — is what relaxes the policy, and it relaxes it
   * only for that origin: `@vitejs/plugin-react` injects an inline preamble and HMR needs
   * a websocket, neither of which the production policy permits. An unpackaged run that
   * still serves `app://` gets the strict policy.
   */
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
  const { devServerUrl, providerOrigins = RENDERER_PROVIDER_ORIGINS } = options

  const scriptSrc = ["'self'", "'wasm-unsafe-eval'"]
  const styleSrc = ["'self'"]
  // `media:` here (as opposed to `media-src`) is what lets the renderer `fetch()` a blob —
  // for Range probing, or any future in-app processing — rather than only handing its URL
  // to an `<audio>`/`<video>` element.
  const connectSrc = ["'self'", 'media:', ...providerOrigins]

  const devOrigin = devServerUrl ? originOf(devServerUrl) : null
  if (devOrigin) {
    // The React Fast Refresh preamble is an inline script, and Vite's CSS HMR injects
    // updated stylesheets as inline <style> tags — both dev-only, both absent from the
    // built app the packaged/production policy actually ships.
    scriptSrc.push("'unsafe-inline'")
    styleSrc.push("'unsafe-inline'")
    connectSrc.push(devOrigin, devOrigin.replace(/^http/, 'ws'))
  }

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    `style-src ${styleSrc.join(' ')}`,
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
