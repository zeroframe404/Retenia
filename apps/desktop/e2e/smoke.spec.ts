import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const mainEntry = path.join(here, '../out/main/index.js')

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [mainEntry],
    // `is.dev` is true for an unpackaged app, so the dev-server URL must be absent or the
    // window would try to load a Vite server that is not running instead of `app://`.
    env: { ...process.env, ELECTRON_RENDERER_URL: '', NODE_ENV: 'production' },
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('serves the renderer from the app:// origin', async () => {
  expect(page.url()).toMatch(/^app:\/\/retenia\//)
})

test('leaves no Node reachable from the renderer', async () => {
  // Playwright always launches Electron with the Chromium `--no-sandbox` flag, so this run
  // proves the JavaScript boundary (contextIsolation + the sandboxed renderer client), not
  // the OS-level sandbox.
  expect(await page.evaluate(() => typeof (globalThis as Record<string, unknown>).require)).toBe(
    'undefined',
  )
  expect(await page.evaluate(() => typeof (globalThis as Record<string, unknown>).process)).toBe(
    'undefined',
  )
  expect(await page.evaluate(() => typeof (globalThis as Record<string, unknown>).module)).toBe(
    'undefined',
  )
})

test('exposes only the generated api, never ipcRenderer', async () => {
  const surface = await page.evaluate(() => ({
    api: typeof window.api,
    electron: typeof (window as unknown as Record<string, unknown>).electron,
    ipcRenderer: typeof (window.api as unknown as Record<string, unknown>).ipcRenderer,
    channels: Object.keys(window.api.app).sort(),
    events: typeof window.api.events.on,
  }))

  expect(surface).toEqual({
    api: 'object',
    electron: 'undefined',
    ipcRenderer: 'undefined',
    channels: ['devMediaSampleUrl', 'getVersion', 'ping'],
    events: 'function',
  })
})

test('app.ping resolves with an ok envelope', async () => {
  const result = await page.evaluate(() =>
    window.api.app.ping({ sentAt: new Date().toISOString() }),
  )

  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(Date.parse(result.data.receivedAt)).not.toBeNaN()
  }
})

test('invalid input to app.ping resolves with {ok:false}, it does not reject', async () => {
  const result = await page.evaluate(() => window.api.app.ping({ sentAt: 'not-a-date' } as never))

  expect(result).toEqual({
    ok: false,
    error: { code: 'INVALID_INPUT', message: expect.any(String) },
  })
})

test('serves a Content-Security-Policy header with the provider allowlist', async () => {
  const response = await page.goto(page.url())
  const csp = response?.headers()['content-security-policy']

  expect(csp).toBeTruthy()

  // Exact directive match, not `toContain`: a substring check on
  // "script-src 'self' 'wasm-unsafe-eval'" passes happily against a policy that also
  // carries 'unsafe-inline', which is the whole thing this assertion exists to catch.
  const directives = (csp ?? '').split('; ')
  expect(directives).toContain("default-src 'self'")
  expect(directives).toContain("script-src 'self' 'wasm-unsafe-eval'")
  expect(directives).toContain("object-src 'none'")

  const connectSrc = directives.find((d) => d.startsWith('connect-src '))
  expect(connectSrc).toContain('https://api.anthropic.com')
  expect(connectSrc).toContain('http://127.0.0.1:11434')

  // This run is unpackaged, so `app.isPackaged` is false — the strict policy must still
  // be what `app://` serves.
  expect(csp).not.toContain("'unsafe-inline' ")
  expect(directives.find((d) => d.startsWith('script-src'))).not.toContain('unsafe-inline')

  // Exactly one policy: a second would intersect with this one.
  expect(csp?.match(/default-src/g)).toHaveLength(1)
})

test('renders the version read over IPC', async () => {
  await page.goto('app://retenia/index.html')
  await expect(page.getByTestId('versions')).toContainText('44.')
})

test('media:// serves the dev sample and honors Range with 206', async () => {
  const sample = await page.evaluate(() => window.api.app.devMediaSampleUrl())
  expect(sample.ok).toBe(true)
  const url = sample.ok ? sample.data.url : null
  expect(url).toMatch(/^media:\/\/blob\/[0-9a-f]{64}\.ogg$/)

  const full = await page.evaluate(async (mediaUrl) => {
    const res = await fetch(mediaUrl as string)
    return { status: res.status, byteLength: (await res.arrayBuffer()).byteLength }
  }, url)
  expect(full.status).toBe(200)
  expect(full.byteLength).toBeGreaterThan(0)

  const ranged = await page.evaluate(async (mediaUrl) => {
    const res = await fetch(mediaUrl as string, { headers: { Range: 'bytes=0-1023' } })
    return {
      status: res.status,
      contentRange: res.headers.get('content-range'),
      byteLength: (await res.arrayBuffer()).byteLength,
    }
  }, url)
  expect(ranged.status).toBe(206)
  expect(ranged.contentRange).toMatch(new RegExp(`^bytes 0-1023/${full.byteLength}$`))
  expect(ranged.byteLength).toBe(1024)
})

test('media:// refuses a traversal attempt against the blob root', async () => {
  const result = await page.evaluate(async () => {
    const res = await fetch('media://blob/..%2f..%2f..%2fetc%2fpasswd')
    return res.status
  })
  expect(result).toBe(403)
})

test('a retenia:// deep link reaches the renderer as an app.deepLink event', async () => {
  await app.evaluate(({ app: electronApp }) => {
    electronApp.emit('open-url', { preventDefault() {} }, 'retenia://review')
  })

  const banner = page.getByTestId('deep-link')
  await expect(banner).toHaveAttribute('data-deep-link-kind', 'review')
  await expect(banner).toContainText('review')
})
