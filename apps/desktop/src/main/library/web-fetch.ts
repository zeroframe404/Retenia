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
 *
 * Scope note: the spec's own row for "Web" (`docs/spec/05-ingestion-rag.md`'s ingestion table)
 * names a *second* escalation tier beyond the hidden-`BrowserWindow` SPA fallback — Jina Reader
 * or Firecrawl, for whole documentation sites the two local extraction paths here still can't
 * make sense of. That tier is a paid third-party API, which belongs with the rest of the
 * provider layer (roles, keys, cost estimation, consent) sub-phase 7.x adds — not duplicated
 * ad hoc here. Until then, a site neither `net.fetch` nor the SPA fallback can extract correctly
 * gets whatever `extractArticle`'s raw-`<body>` last resort produces, same as any other page that
 * defeats both extractors.
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

/**
 * Every call in this file passes a plain string URL, so this is deliberately narrower than
 * `typeof fetch`: Electron's `net.fetch` types its `input` parameter as `string | Request` (no
 * `URL`), which is not assignable to the DOM lib's wider `typeof fetch` — so a helper typed
 * against the ambient global would reject `net.fetch` as its default. Both satisfy this one (the
 * same reasoning `youtube-fetch.ts`'s own `FetchImpl` documents).
 */
type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

/** The standard HTTP redirect statuses a `Location` header accompanies. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
/** Same bound a browser effectively applies (Chrome's own limit is 20); nothing legitimate
 *  chains this many hops, and it caps how long a hostile server can stall this loop. */
const MAX_REDIRECTS = 10

export interface FetchWebPageResult {
  /** The final URL after redirects — what `SourceDoc.meta.origin.url` records. */
  url: string
  html: string
  fetchedAt: string
  /** True when the static fetch was too thin and the hidden `BrowserWindow` fallback rendered
   *  the page instead — carried through so `parse-web.ts` can warn about it. */
  rendered: boolean
}

/** `<script>`/`<style>`/`<noscript>` content is never prose — a bundle, a stylesheet, a
 *  fallback-markup blob — so it has to go *before* `countWords` strips tags, not just the tags
 *  themselves: a client-rendered page's shell is routinely a bare `<div id="root">` plus an
 *  inline `__NEXT_DATA__`/webpack bundle that alone runs to thousands of "words" once the tags
 *  around it are gone, which used to make exactly the SPA shell this threshold exists to catch
 *  read as a real, populated page. Matches `parse-web.ts`'s own `SKIP_TAGS` for these three —
 *  the two files agree on what "not text" means for the same reason. */
const NON_TEXT_ELEMENTS = /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi

function countWords(html: string): number {
  const text = html
    .replace(NON_TEXT_ELEMENTS, ' ')
    .replace(/<[^>]*>/g, ' ')
    .trim()
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
  fetchImpl?: FetchImpl
  /** Test seam for the SPA fallback; `renderWithHiddenWindow` otherwise. */
  renderFallback?: (url: string) => Promise<string>
  /** Test seam for the SSRF guard; the real DNS-resolving check otherwise. */
  assertPublicUrl?: typeof assertPublicHttpUrl
}

/**
 * Fetches `url`, following redirects one hop at a time and re-running the SSRF guard on every
 * hop before it is requested — not just on the input URL and the final one. `redirect: 'manual'`
 * is what makes this possible: with the default `'follow'`, `net.fetch` would resolve the whole
 * chain internally and hand back only the last response, so a public-looking URL that 302s
 * through `http://169.254.169.254/…` on its way to a harmless final page would have already
 * issued that intermediate request — a blind SSRF GET — before anything here got a chance to see
 * it (`security-reviewer` finding "New-1": checking only the final URL, as an earlier version of
 * this function did, closes the direct case but not the redirect-chain one).
 */
async function fetchFollowingValidatedRedirects(
  url: string,
  fetchImpl: FetchImpl,
  assertPublicUrl: typeof assertPublicHttpUrl,
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = url

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicUrl(currentUrl)

    const response = await fetchImpl(currentUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'manual',
    })

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, finalUrl: currentUrl }
    }

    const location = response.headers.get('location')
    if (location === null) {
      throw new Error(
        `redirect (status ${response.status}) from "${currentUrl}" carried no Location header`,
      )
    }
    currentUrl = new URL(location, currentUrl).toString()
  }

  throw new Error(`"${url}" redirected more than ${MAX_REDIRECTS} times`)
}

export async function fetchWebPage(
  url: string,
  deps: FetchWebPageDeps = {},
): Promise<FetchWebPageResult> {
  const fetchImpl = deps.fetchImpl ?? net.fetch
  const renderFallback = deps.renderFallback ?? renderWithHiddenWindow
  const assertPublicUrl = deps.assertPublicUrl ?? assertPublicHttpUrl

  const { response, finalUrl } = await fetchFollowingValidatedRedirects(
    url,
    fetchImpl,
    assertPublicUrl,
  )
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} fetching "${url}"`)
  }

  const html = await readCapped(response, MAX_PAGE_BYTES)

  if (countWords(html) >= SPA_FALLBACK_WORD_THRESHOLD) {
    return { url: finalUrl, html, fetchedAt: new Date().toISOString(), rendered: false }
  }

  const rendered = await renderFallback(finalUrl)
  return { url: finalUrl, html: rendered, fetchedAt: new Date().toISOString(), rendered: true }
}
