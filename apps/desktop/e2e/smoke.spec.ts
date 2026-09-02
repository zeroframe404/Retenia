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
    channels: ['getVersion', 'ping'],
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
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'")
  expect(csp).toContain('https://api.anthropic.com')
  expect(csp).toContain('http://127.0.0.1:11434')
  // Exactly one policy: a second would intersect with this one.
  expect(csp?.match(/default-src/g)).toHaveLength(1)
})

test('renders the version read over IPC', async () => {
  await page.goto('app://retenia/index.html')
  await expect(page.getByTestId('versions')).toContainText('44.')
})
