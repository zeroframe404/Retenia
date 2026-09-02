import { callApi, expect, screenshot, test } from './fixtures'

test('serves the renderer from the app:// origin', async ({ window }) => {
  expect(window.url()).toMatch(/^app:\/\/retenia\//)
})

test('main window title is Retenia', async ({ window }) => {
  await expect(window).toHaveTitle('Retenia')
})

test('leaves no Node reachable from the renderer', async ({ window }) => {
  // Playwright always launches Electron with the Chromium `--no-sandbox` flag, so this run
  // proves the JavaScript boundary (contextIsolation + the sandboxed renderer client), not
  // the OS-level sandbox.
  expect(await window.evaluate(() => typeof (globalThis as Record<string, unknown>).require)).toBe(
    'undefined',
  )
  expect(await window.evaluate(() => typeof (globalThis as Record<string, unknown>).process)).toBe(
    'undefined',
  )
  expect(await window.evaluate(() => typeof (globalThis as Record<string, unknown>).module)).toBe(
    'undefined',
  )
})

test('exposes only the generated api, never ipcRenderer', async ({ window }) => {
  const surface = await window.evaluate(() => ({
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
    channels: [
      'checkForUpdates',
      'devMediaSampleUrl',
      'exportDiagnostics',
      'getSettings',
      'getVersion',
      'ping',
      'quitAndInstall',
      'reportRendererError',
      'setTelemetryEnabled',
      'setUpdateChannel',
    ],
    events: 'function',
  })
})

test('app.ping resolves with an ok envelope', async ({ window }) => {
  const result = await callApi(window, (api) => api.app.ping({ sentAt: new Date().toISOString() }))

  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(Date.parse(result.data.receivedAt)).not.toBeNaN()
  }
})

test('invalid input to app.ping resolves with {ok:false}, it does not reject', async ({
  window,
}) => {
  const result = await callApi(window, (api) => api.app.ping({ sentAt: 'not-a-date' } as never))

  expect(result).toEqual({
    ok: false,
    error: { code: 'INVALID_INPUT', message: expect.any(String) },
  })
})

test('serves a Content-Security-Policy header with the provider allowlist', async ({ window }) => {
  const response = await window.goto(window.url())
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

test('renders the version read over IPC and a screenshot is saved', async ({ window }) => {
  await window.goto('app://retenia/index.html')
  await expect(window.getByTestId('versions')).toContainText('44.')
  await screenshot(window, 'smoke-main-window')
})

test('media:// serves the dev sample and honors Range with 206', async ({ window }) => {
  const sample = await callApi(window, (api) => api.app.devMediaSampleUrl())
  expect(sample.ok).toBe(true)
  const url = sample.ok ? sample.data.url : null
  expect(url).toMatch(/^media:\/\/blob\/[0-9a-f]{64}\.ogg$/)

  const full = await window.evaluate(async (mediaUrl) => {
    const res = await fetch(mediaUrl as string)
    return { status: res.status, byteLength: (await res.arrayBuffer()).byteLength }
  }, url)
  expect(full.status).toBe(200)
  expect(full.byteLength).toBeGreaterThan(0)

  const ranged = await window.evaluate(async (mediaUrl) => {
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

test('media:// refuses a traversal attempt against the blob root', async ({ window }) => {
  const result = await window.evaluate(async () => {
    const res = await fetch('media://blob/..%2f..%2f..%2fetc%2fpasswd')
    return res.status
  })
  expect(result).toBe(403)
})

test('a retenia:// deep link reaches the renderer as an app.deepLink event', async ({
  electronApp,
  window,
}) => {
  await electronApp.evaluate(({ app: electronApp }) => {
    electronApp.emit('open-url', { preventDefault() {} }, 'retenia://review')
  })

  const banner = window.getByTestId('deep-link')
  await expect(banner).toHaveAttribute('data-deep-link-kind', 'review')
  await expect(banner).toContainText('review')
})
