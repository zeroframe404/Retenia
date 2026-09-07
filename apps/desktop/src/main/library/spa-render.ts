import { BrowserWindow, session } from 'electron'

/**
 * The SPA fallback for the web importer (`docs/spec/05-ingestion-rag.md` §1: "a hidden
 * `BrowserWindow` for SPAs (if the static HTML brings < 500 words)").
 *
 * A page that renders its content with client-side JavaScript gives `net.fetch` an almost-empty
 * shell; the only way to see what a reader would actually see is to run that JavaScript, which
 * means an off-screen browser tab. Everything here is chosen to make that tab as powerless as
 * the app's own renderer is *not* trusted to be less of: no preload (so no `window.api` bridge
 * exists for a hostile page to reach for), sandboxed, no Node integration, and an in-memory
 * session — no `persist:` prefix — so a scraped site's cookies never touch anything this app
 * keeps between runs and never mix with the main window's own session.
 *
 * The scrape session is a *different* session from `session.defaultSession`, which means the
 * permission handlers `main/security/apply.ts` installs — deny everything except the
 * microphone, from the app's own origin — do not cover it. Electron's documented default when
 * no handler is installed at all is to *grant* every permission request, so this window installs
 * its own deny-everything handlers directly; a page loaded here that calls
 * `getUserMedia`/`getDisplayMedia`/geolocation must be refused exactly as it would be from the
 * main window, not silently allowed because it happens to run on a different session
 * (`security-reviewer` finding H2). Reached only through `web-fetch.ts`, which is the one call
 * site responsible for refusing a non-public URL before it ever gets here (`./url-safety`).
 */

const DEFAULT_TIMEOUT_MS = 20_000
/** How long client-side rendering gets to run after the initial load before the DOM is read.
 *  Electron has no "network idle" signal the way CDP's Network domain does; a fixed settle
 *  window after `did-finish-load` is the practical approximation every scraper without direct
 *  CDP access ends up using. */
const SETTLE_MS = 1_500
const SCRAPE_PARTITION = 'web-import-scrape'
/** Same cap `web-fetch.ts` applies to a static fetch (`MAX_PAGE_BYTES`) — duplicated rather than
 *  imported to avoid a circular import (`web-fetch.ts` imports this module for the fallback
 *  itself). A rendered page's `outerHTML` is exactly as attacker-controlled as a static page's
 *  body, and unlike the static path there is no streaming reader to abort mid-flight here — the
 *  string already exists in the renderer's memory by the time this checks it — so the guard is
 *  a length check on what `executeJavaScript` returns, not a cap on how much is read. */
const MAX_RENDERED_HTML_CHARS = 10 * 1024 * 1024
/** Nothing upstream limits how many imports can be in flight at once — a compromised renderer
 *  calling `library.addSourceFromUrl` in a loop, or a page that got "always allow" on the
 *  `retenia://import` protocol prompt and fires it repeatedly, could otherwise spawn an
 *  unbounded number of real Chromium renderer processes (`security-reviewer` finding L4). A
 *  small semaphore around window creation caps that without capping ordinary, one-at-a-time use
 *  at all. */
const MAX_CONCURRENT_RENDERS = 4

let activeRenders = 0
const renderQueue: (() => void)[] = []

async function acquireRenderSlot(): Promise<void> {
  if (activeRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders += 1
    return
  }
  await new Promise<void>((resolve) => renderQueue.push(resolve))
  activeRenders += 1
}

function releaseRenderSlot(): void {
  activeRenders -= 1
  const next = renderQueue.shift()
  if (next !== undefined) next()
}

export interface RenderWithHiddenWindowOptions {
  timeoutMs?: number
  settleMs?: number
  /** Test seam: a distinct in-memory partition per test avoids one test's leftover window
   *  state leaking into another's. */
  partition?: string
}

export class SpaRenderTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Rendering "${url}" took longer than ${timeoutMs}ms`)
    this.name = 'SpaRenderTimeoutError'
  }
}

export class RenderedPageTooLargeError extends Error {
  constructor(url: string, maxChars: number) {
    super(`Rendering "${url}" produced more than ${maxChars} characters of HTML`)
    this.name = 'RenderedPageTooLargeError'
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Loads `url` in a hidden window, lets client-side rendering settle, and returns
 * `document.documentElement.outerHTML` — the rendered page `parse-web.ts` extracts from exactly
 * as if it had been the original static response.
 */
export async function renderWithHiddenWindow(
  url: string,
  options: RenderWithHiddenWindowOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const settleMs = options.settleMs ?? SETTLE_MS

  await acquireRenderSlot()
  try {
    return await renderInAcquiredSlot(url, timeoutMs, settleMs, options.partition)
  } finally {
    releaseRenderSlot()
  }
}

async function renderInAcquiredSlot(
  url: string,
  timeoutMs: number,
  settleMs: number,
  partition: string | undefined,
): Promise<string> {
  const scrapeSession = session.fromPartition(partition ?? SCRAPE_PARTITION)
  // No handler on this session's own defaults to "allow" (Electron's documented behaviour for
  // an un-set `setPermissionRequestHandler`), and this session is never the one
  // `main/security/apply.ts` hardens — so every permission a scraped page could ask for is
  // refused right here, deny-by-default, exactly as the default session already is.
  scrapeSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  scrapeSession.setPermissionCheckHandler(() => false)
  scrapeSession.setDevicePermissionHandler(() => false)
  scrapeSession.setDisplayMediaRequestHandler(null)

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      webviewTag: false,
      // A scraped page calling `alert()`/`confirm()`/`prompt()` gets no dialog to answer —
      // there is no one to see it on a hidden window, and an unanswered one would otherwise
      // stall the DOM read below indefinitely.
      disableDialogs: true,
      session: scrapeSession,
    },
  })
  // This window shows the user nothing and asks for nothing; a page that tries to open a
  // popup (an ad, a cookie-consent redirect) gets refused rather than spawning a second
  // hidden window this function does not track.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new SpaRenderTimeoutError(url, timeoutMs)), timeoutMs)
  })

  try {
    // The whole sequence — load, settle, read — races the one deadline. Racing only `loadURL`
    // (as an earlier version of this function did) left a page that finishes loading and then
    // hangs its main thread (or never stops running client-side work) free to block the settle
    // delay and the `executeJavaScript` call forever, with the timeout already spent and the
    // window never destroyed (`security-reviewer` finding M1).
    const html = await Promise.race([
      (async () => {
        await window.loadURL(url)
        await delay(settleMs)
        return window.webContents.executeJavaScript(
          `document.documentElement.outerHTML.slice(0, ${MAX_RENDERED_HTML_CHARS + 1})`,
        )
      })(),
      timeout,
    ])
    if (typeof html === 'string' && html.length > MAX_RENDERED_HTML_CHARS) {
      throw new RenderedPageTooLargeError(url, MAX_RENDERED_HTML_CHARS)
    }
    return html as string
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    // Storage this scraped page set (cookies, localStorage) is origin-scoped and already
    // in-memory-only, but the partition is reused across every import for the app's lifetime —
    // clearing it here keeps one scrape from being able to read another's leftovers.
    await scrapeSession.clearStorageData()
    if (!window.isDestroyed()) window.destroy()
  }
}
