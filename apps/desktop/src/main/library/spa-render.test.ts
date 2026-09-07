import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeBrowserWindow {
  static instances: FakeBrowserWindow[] = []
  webContents = {
    setWindowOpenHandler: vi.fn(),
    executeJavaScript: vi.fn(async () => '<html><body>rendered</body></html>'),
  }
  loadURL = vi.fn(async () => {})
  private destroyed = false

  constructor(public opts: Record<string, unknown>) {
    FakeBrowserWindow.instances.push(this)
  }

  destroy() {
    this.destroyed = true
  }

  isDestroyed() {
    return this.destroyed
  }
}

function makeFakeSession(partition: string) {
  return {
    partition,
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    setDisplayMediaRequestHandler: vi.fn(),
    clearStorageData: vi.fn(async () => {}),
  }
}

const fromPartition = vi.fn((partition: string) => makeFakeSession(partition))

vi.mock('electron', () => ({
  BrowserWindow: FakeBrowserWindow,
  session: { fromPartition },
}))

const { renderWithHiddenWindow } = await import('./spa-render')

beforeEach(() => {
  FakeBrowserWindow.instances = []
  fromPartition.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('renderWithHiddenWindow', () => {
  it('loads the URL and returns the rendered outerHTML', async () => {
    const html = await renderWithHiddenWindow('https://example.com/spa', { settleMs: 0 })
    expect(html).toBe('<html><body>rendered</body></html>')

    const window = FakeBrowserWindow.instances[0] as unknown as FakeBrowserWindow
    expect(window.loadURL).toHaveBeenCalledWith('https://example.com/spa')
  })

  it('never shows the window and never gives it a preload', async () => {
    await renderWithHiddenWindow('https://example.com/spa', { settleMs: 0 })
    const window = FakeBrowserWindow.instances[0] as unknown as FakeBrowserWindow
    expect(window.opts.show).toBe(false)
    expect(window.opts.webPreferences).not.toHaveProperty('preload')
  })

  it('sandboxes the window with no Node integration', async () => {
    await renderWithHiddenWindow('https://example.com/spa', { settleMs: 0 })
    const window = FakeBrowserWindow.instances[0] as unknown as FakeBrowserWindow
    const prefs = window.opts.webPreferences as Record<string, unknown>
    expect(prefs.sandbox).toBe(true)
    expect(prefs.contextIsolation).toBe(true)
    expect(prefs.nodeIntegration).toBe(false)
  })

  it('uses an in-memory session partition, never a persisted one', async () => {
    await renderWithHiddenWindow('https://example.com/spa', { settleMs: 0 })
    expect(fromPartition).toHaveBeenCalledOnce()
    const [partition] = fromPartition.mock.calls[0] as [string]
    expect(partition.startsWith('persist:')).toBe(false)
  })

  it('denies any attempt by the page to open a new window', async () => {
    await renderWithHiddenWindow('https://example.com/spa', { settleMs: 0 })
    const window = FakeBrowserWindow.instances[0] as unknown as FakeBrowserWindow
    expect(window.webContents.setWindowOpenHandler).toHaveBeenCalledOnce()
    const handler = window.webContents.setWindowOpenHandler.mock.calls[0]?.[0] as () => {
      action: string
    }
    expect(handler()).toEqual({ action: 'deny' })
  })

  it('destroys the window once done, even on success', async () => {
    await renderWithHiddenWindow('https://example.com/spa', { settleMs: 0 })
    const window = FakeBrowserWindow.instances[0] as unknown as FakeBrowserWindow
    expect(window.isDestroyed()).toBe(true)
  })

  it('destroys the window and rejects when the load itself fails', async () => {
    class FailingWindow extends FakeBrowserWindow {
      override loadURL = vi.fn(async () => {
        throw new Error('net::ERR_NAME_NOT_RESOLVED')
      })
    }
    vi.doMock('electron', () => ({ BrowserWindow: FailingWindow, session: { fromPartition } }))
    vi.resetModules()
    const { renderWithHiddenWindow: renderFailing } = await import('./spa-render')

    await expect(renderFailing('https://broken.example', { settleMs: 0 })).rejects.toThrow(
      'net::ERR_NAME_NOT_RESOLVED',
    )
    const window = FailingWindow.instances.at(-1) as unknown as FailingWindow
    expect(window.isDestroyed()).toBe(true)
  })

  it('times out (and destroys the window) rather than hanging forever on a stuck load', async () => {
    class HangingWindow extends FakeBrowserWindow {
      override loadURL = vi.fn(() => new Promise<void>(() => {}))
    }
    vi.doMock('electron', () => ({ BrowserWindow: HangingWindow, session: { fromPartition } }))
    vi.resetModules()
    const {
      renderWithHiddenWindow: renderHanging,
      SpaRenderTimeoutError: TimeoutErrorFromThisModule,
    } = await import('./spa-render')

    await expect(
      renderHanging('https://slow.example', { timeoutMs: 5, settleMs: 0 }),
    ).rejects.toThrow(TimeoutErrorFromThisModule)
    const window = HangingWindow.instances.at(-1) as unknown as HangingWindow
    expect(window.isDestroyed()).toBe(true)
  })

  it('times out (and destroys the window) when the page loads fine but never settles', async () => {
    // Regression for a bug where only `loadURL` was raced against the timeout: a page whose
    // load resolves normally but whose main thread then never idles (or which never stops
    // running client-side work) left the settle delay and `executeJavaScript` unbounded.
    class StuckAfterLoadWindow extends FakeBrowserWindow {
      override webContents = {
        setWindowOpenHandler: vi.fn(),
        executeJavaScript: vi.fn(() => new Promise<string>(() => {})),
      }
    }
    vi.doMock('electron', () => ({
      BrowserWindow: StuckAfterLoadWindow,
      session: { fromPartition },
    }))
    vi.resetModules()
    const {
      renderWithHiddenWindow: renderStuck,
      SpaRenderTimeoutError: TimeoutErrorFromThisModule,
    } = await import('./spa-render')

    await expect(
      renderStuck('https://slow.example', { timeoutMs: 5, settleMs: 0 }),
    ).rejects.toThrow(TimeoutErrorFromThisModule)
    const window = StuckAfterLoadWindow.instances.at(-1) as unknown as StuckAfterLoadWindow
    expect(window.isDestroyed()).toBe(true)
  })

  it('denies every permission request on the scrape session, not just window.open', async () => {
    await renderWithHiddenWindow('https://example.com/spa', { settleMs: 0 })
    const scrapeSession = fromPartition.mock.results[0]?.value as ReturnType<typeof makeFakeSession>

    expect(scrapeSession.setPermissionRequestHandler).toHaveBeenCalledOnce()
    const requestHandler = scrapeSession.setPermissionRequestHandler.mock.calls[0]?.[0] as (
      contents: unknown,
      permission: string,
      callback: (granted: boolean) => void,
    ) => void
    const callback = vi.fn()
    requestHandler(undefined, 'media', callback)
    expect(callback).toHaveBeenCalledWith(false)

    expect(scrapeSession.setPermissionCheckHandler).toHaveBeenCalledOnce()
    const checkHandler = scrapeSession.setPermissionCheckHandler.mock.calls[0]?.[0] as () => boolean
    expect(checkHandler()).toBe(false)

    expect(scrapeSession.setDevicePermissionHandler).toHaveBeenCalledOnce()
    const deviceHandler = scrapeSession.setDevicePermissionHandler.mock
      .calls[0]?.[0] as () => boolean
    expect(deviceHandler()).toBe(false)

    expect(scrapeSession.setDisplayMediaRequestHandler).toHaveBeenCalledWith(null)
  })

  it('disables JS dialogs (alert/confirm/prompt) on the hidden window', async () => {
    await renderWithHiddenWindow('https://example.com/spa', { settleMs: 0 })
    const window = FakeBrowserWindow.instances[0] as unknown as FakeBrowserWindow
    const prefs = window.opts.webPreferences as Record<string, unknown>
    expect(prefs.disableDialogs).toBe(true)
  })

  it('clears the scrape session storage after rendering, on success', async () => {
    await renderWithHiddenWindow('https://example.com/spa', { settleMs: 0 })
    const scrapeSession = fromPartition.mock.results[0]?.value as ReturnType<typeof makeFakeSession>
    expect(scrapeSession.clearStorageData).toHaveBeenCalledOnce()
  })

  it('clears the scrape session storage even when the render fails', async () => {
    class FailingWindow extends FakeBrowserWindow {
      override loadURL = vi.fn(async () => {
        throw new Error('net::ERR_NAME_NOT_RESOLVED')
      })
    }
    vi.doMock('electron', () => ({ BrowserWindow: FailingWindow, session: { fromPartition } }))
    vi.resetModules()
    const { renderWithHiddenWindow: renderFailing } = await import('./spa-render')

    await expect(renderFailing('https://broken.example', { settleMs: 0 })).rejects.toThrow()
    const scrapeSession = fromPartition.mock.results.at(-1)?.value as ReturnType<
      typeof makeFakeSession
    >
    expect(scrapeSession.clearStorageData).toHaveBeenCalledOnce()
  })

  it('rejects a rendered page larger than the size cap', async () => {
    class HugePageWindow extends FakeBrowserWindow {
      override webContents = {
        setWindowOpenHandler: vi.fn(),
        executeJavaScript: vi.fn(async () => 'x'.repeat(10 * 1024 * 1024 + 1)),
      }
    }
    vi.doMock('electron', () => ({ BrowserWindow: HugePageWindow, session: { fromPartition } }))
    vi.resetModules()
    const { renderWithHiddenWindow: renderHuge, RenderedPageTooLargeError } = await import(
      './spa-render'
    )

    await expect(renderHuge('https://huge.example', { settleMs: 0 })).rejects.toThrow(
      RenderedPageTooLargeError,
    )
  })

  it('caps the number of concurrent renders, queueing the rest until a slot frees up', async () => {
    const releasers: (() => void)[] = []
    class ControllableWindow extends FakeBrowserWindow {
      override loadURL = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releasers.push(resolve)
          }),
      )
    }
    vi.doMock('electron', () => ({ BrowserWindow: ControllableWindow, session: { fromPartition } }))
    vi.resetModules()
    const { renderWithHiddenWindow: renderControllable } = await import('./spa-render')

    // One more than the concurrency cap (4): the 5th must wait for a slot.
    const results = [0, 1, 2, 3, 4].map((i) =>
      renderControllable(`https://queued.example/${i}`, { settleMs: 0 }),
    )
    await Promise.resolve() // let the microtask queue settle so windows have been constructed
    await Promise.resolve()

    expect(ControllableWindow.instances).toHaveLength(4)

    // `settleMs: 0` still goes through a real `setTimeout(…, 0)`, not just a microtask, so
    // this needs an actual macrotask tick (not another `Promise.resolve()`) to let window 0's
    // settle-and-destroy sequence finish and free its slot for the queued 5th render.
    releasers[0]?.()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(ControllableWindow.instances).toHaveLength(5)

    for (const release of releasers) release()
    await Promise.all(results)
  })
})
