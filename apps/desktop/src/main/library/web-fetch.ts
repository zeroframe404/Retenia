import { net } from 'electron'
import { renderWithHiddenWindow } from './spa-render'
import { assertPublicHttpUrl } from './url-safety'

/**
 * The web importer's page fetch (`docs/spec/05-ingestion-rag.md` §1: "fetch with `net.fetch` in
 * main (user-agent, timeout, size cap 10 MB)"), with the SPA fallback ("a hidden `BrowserWindow`
 * for SPAs, if the static HTML brings < 500 words").
 *
 * `net.fetch` rather than Node's `fetch`: it runs over Chromium's own network stack — the same
 * one the renderer's own requests go through — so it picks up the app's proxy configuration and
 * certificate handling for free, which a bare Node fetch would not.
 */

/**
 * A recent desktop Chrome UA. Electron's own default `User-Agent` announces itself as
 * `…Electron/44…`, and a fair number of ordinary sites serve a stripped-down page (or refuse the
 * request outright) to anything that looks automated. This is a personal import of a page the
 * user is already looking at in their own browser, not a crawler — presenting as an ordinary
 * browser is what gets the same page a human visitor would see, not an attempt to evade anything
 * a site restricts to real browsers on purpose (that is what the SPA fallback below is for, and
 * only for pages that are legitimately client-rendered).
 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const MAX_PAGE_BYTES = 10 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20_000
/** Below this many words, the static HTML is presumed to be an SPA shell rather than the
 *  article itself. */
const SPA_FALLBACK_WORD_THRESHOLD = 500

export interface FetchWebPageResult {
  /** The final URL after redirects — what `SourceDoc.meta.origin.url` records. */
  url: string
  html: string
  fetchedAt: string
  /** True when the static fetch was too thin and the hidden `BrowserWindow` fallback rendered
   *  the page instead — carried through so `parse-web.ts` can warn about it. */
  rendered: boolean
}

function countWords(html: string): number {
  const text = html.replace(/<[^>]*>/g, ' ').trim()
  return text.length === 0 ? 0 : text.split(/\s+/).length
}

/** Reads the body up to `maxBytes`, aborting the stream (not just the accumulation) the moment
 *  it is exceeded — a hostile or merely huge page must not sit in memory in full before this
 *  notices. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error(`the page at this URL is larger than ${maxBytes} bytes`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export interface FetchWebPageDeps {
  /** Test seam; `net.fetch` otherwise. */
  fetchImpl?: typeof fetch
  /** Test seam for the SPA fallback; `renderWithHiddenWindow` otherwise. */
  renderFallback?: (url: string) => Promise<string>
  /** Test seam for the SSRF guard; the real DNS-resolving check otherwise. */
  assertPublicUrl?: typeof assertPublicHttpUrl
}

export async function fetchWebPage(
  url: string,
  deps: FetchWebPageDeps = {},
): Promise<FetchWebPageResult> {
  const fetchImpl = deps.fetchImpl ?? net.fetch
  const renderFallback = deps.renderFallback ?? renderWithHiddenWindow
  const assertPublicUrl = deps.assertPublicUrl ?? assertPublicHttpUrl

  // Refuses a URL that is not http(s), or whose host resolves to a loopback/private/link-local
  // address, *before* the request goes out — this is the one place every importer entry point
  // funnels through (the paste-URL dialog and the `retenia://import` deep link alike), so it is
  // the one place that has to stop a pasted or deep-linked URL from turning this importer into
  // an SSRF probe of the user's own machine or LAN (`security-reviewer` finding H1).
  await assertPublicUrl(url)

  const response = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} fetching "${url}"`)
  }

  const finalUrl = response.url || url
  // `net.fetch` follows redirects by default, so the request may have landed somewhere other
  // than `url` — a public-looking link can 302 to a private address just as easily as a pasted
  // one can name it directly. Checked again here, before the body is read or the SPA fallback
  // (which would run the target's own JavaScript) ever sees it.
  if (finalUrl !== url) await assertPublicUrl(finalUrl)

  const html = await readCapped(response, MAX_PAGE_BYTES)

  if (countWords(html) >= SPA_FALLBACK_WORD_THRESHOLD) {
    return { url: finalUrl, html, fetchedAt: new Date().toISOString(), rendered: false }
  }

  const rendered = await renderFallback(finalUrl)
  return { url: finalUrl, html: rendered, fetchedAt: new Date().toISOString(), rendered: true }
}
