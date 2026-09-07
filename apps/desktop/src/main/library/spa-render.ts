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
/** A caller looping on a rejected/slow import could otherwise queue an unbounded number of
 *  pending renders behind the 4 active slots — bounded so that failure mode is a clear rejection
 *  instead of unbounded memory growth (`security-reviewer` finding "New-7"). */
const MAX_QUEUED_RENDERS = 50

export class TooManyPendingRendersError extends Error {
  constructor() {
    super(`More than ${MAX_QUEUED_RENDERS} imports are already waiting to render`)
    this.name = 'TooManyPendingRendersError'
  }
}

let activeRenders = 0
const renderQueue: (() => void)[] = []

async function acquireRenderSlot(): Promise<void> {
  if (activeRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders += 1
    return
  }
  if (renderQueue.length >= MAX_QUEUED_RENDERS) throw new TooManyPendingRendersError()
  // The waiter's own continuation increments `activeRenders` (see `releaseRenderSlot`) rather
  // than doing it here after the `await` returns: incrementing here would leave a window, between
  // `resolve()` firing and this line actually running, where `activeRenders` still reads as if
  // the slot were free — long enough for a second arrival to read it and over-subscribe by one
  // (`security-reviewer` finding "New-7"). Handing off the slot and the count together in the
  // same synchronous turn closes that window.
  await new Promise<void>((resolve) => renderQueue.push(resolve))
}

function releaseRenderSlot(): void {
  const next = renderQueue.shift()
  if (next !== undefined) {
    next() // Hands the slot straight to the waiter; `activeRenders` itself does not change.
    return
  }
  activeRenders -= 1
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

let renderCounter = 0

async function renderInAcquiredSlot(
  url: string,
  timeoutMs: number,
  settleMs: number,
  partition: string | undefined,
): Promise<string> {
  renderCounter += 1
  // A fresh partition per render, not the one fixed name every call used to share: with up to
  // `MAX_CONCURRENT_RENDERS` renders in flight at once, a shared session meant one render's
  // `clearStorageData()` (below) could wipe cookies/localStorage out from under another render
  // still using the same session — and, worse, a scraped page could read whatever an unrelated,
  // concurrent import's page had just written (`security-reviewer` finding "New-6"). Still never
  // `persist:`-prefixed, so still gone the moment nothing references it.
  const scrapeSession = session.fromPartition(partition ?? `${SCRAPE_PARTITION}-${renderCounter}`)
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

  // Belt-and-suspenders alongside `main/security/apply.ts`'s app-wide `will-navigate` guard:
  // that hook covers every `WebContents` the app creates today, but nothing pins it to *this*
  // window's own loaded origin, and the whole reason this scrape happens off-screen is to keep a
  // hostile page from navigating itself somewhere this function never gets to re-check (a
  // redirect to a private address, for one) and having its response read back regardless
  // (`security-reviewer` finding "New-9"). Pinned to `url`'s own origin computed up front —
  // `web-fetch.ts` already resolved `url` through its own validated redirect chain before ever
  // calling this function, so *any* navigation away from that origin from here on, redirect
  // during the initial load included, is exactly what this refuses; nothing here needs to
  // "learn" the origin reactively from whichever event happens to fire first.
  const loadedOrigin = new URL(url).origin
  const blockForeignNavigation = (event: { preventDefault: () => void }, target: string) => {
    if (new URL(target).origin !== loadedOrigin) event.preventDefault()
  }
  window.webContents.on('will-navigate', blockForeignNavigation)
  window.webContents.on('will-redirect', blockForeignNavigation)

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
    // Not just a length check: a page that redefines `outerHTML`/`slice` to return something
    // else entirely (an object, `undefined`) had that value cast straight to `string` and handed
    // to `parse-web.ts` unexamined (`security-reviewer` finding "New-8").
    if (typeof html !== 'string') {
      throw new TypeError(`Rendering "${url}" returned ${typeof html}, not a string`)
    }
    if (html.length > MAX_RENDERED_HTML_CHARS) {
      throw new RenderedPageTooLargeError(url, MAX_RENDERED_HTML_CHARS)
    }
    return html
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    // Destroyed before the storage clear, not after: if `clearStorageData()` itself rejected,
    // the old order left the window (a real Chromium renderer process) never destroyed at all —
    // this order guarantees the window is gone even then (`security-reviewer` finding "New-6").
    if (!window.isDestroyed()) window.destroy()
    // Belt-and-suspenders now that every render gets its own partition: storage this scraped
    // page set is already in-memory-only and never shared with another render, but clearing it
    // still costs nothing and removes any doubt.
    await scrapeSession.clearStorageData().catch(() => {})
  }
}
