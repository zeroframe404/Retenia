import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeBrowserWindow {
  static instances: FakeBrowserWindow[] = []
  webContents = {
    setWindowOpenHandler: vi.fn(),
    executeJavaScript: vi.fn(async () => '<html><body>rendered</body></html>'),
    on: vi.fn(),
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

type BeforeRequestHandler = (
  details: { url: string },
  callback: (response: { cancel: boolean }) => void,
) => void

function makeFakeSession(partition: string) {
  let beforeRequestHandler: BeforeRequestHandler | undefined
  return {
    partition,
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    setDisplayMediaRequestHandler: vi.fn(),
    clearStorageData: vi.fn(async () => {}),
    webRequest: {
      onBeforeRequest: vi.fn((handler: BeforeRequestHandler) => {
        beforeRequestHandler = handler
      }),
    },
    /** Test seam: the handler `spa-render.ts` registered, once a render has started. */
    getBeforeRequestHandler: (): BeforeRequestHandler => {
      if (beforeRequestHandler === undefined) throw new Error('onBeforeRequest was never called')
      return beforeRequestHandler
    },
  }
}

/** Runs a captured `onBeforeRequest` handler and resolves with what it decided. */
function askBeforeRequest(
  session: ReturnType<typeof makeFakeSession>,
  url: string,
): Promise<{ cancel: boolean }> {
  return new Promise((resolve) => session.getBeforeRequestHandler()({ url }, resolve))
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
        on: vi.fn(),
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
        on: vi.fn(),
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

  it('rejects once the queue behind the concurrency cap is itself full, without spawning a window', async () => {
    // Never resolves on its own — each of the 54 background renders below carries its own short
    // `timeoutMs` instead, so the queue drains itself (via the ordinary `SpaRenderTimeoutError`
    // path) once the assertion is done, with no manual release bookkeeping needed here.
    class ControllableWindow extends FakeBrowserWindow {
      override loadURL = vi.fn(() => new Promise<void>(() => {}))
    }
    vi.doMock('electron', () => ({ BrowserWindow: ControllableWindow, session: { fromPartition } }))
    vi.resetModules()
    const { renderWithHiddenWindow: renderControllable, TooManyPendingRendersError } = await import(
      './spa-render'
    )

    // 4 active + 50 queued fills every slot this module allows; the 55th has nowhere to wait.
    // Filling and checking that happens synchronously, within this one tick — `acquireRenderSlot`
    // pushes its queue entry (or increments the active count) before its first `await`, so all 54
    // calls below have already been sorted into "active" or "queued" by the time this line
    // returns, with no `Promise.resolve()` flush needed to observe it.
    const pending = Array.from({ length: 54 }, (_, i) =>
      renderControllable(`https://queued.example/${i}`, { settleMs: 0, timeoutMs: 20 }).catch(
        () => null,
      ),
    )

    await expect(
      renderControllable('https://one-too-many.example', { settleMs: 0, timeoutMs: 20 }),
    ).rejects.toThrow(TooManyPendingRendersError)
    expect(ControllableWindow.instances).toHaveLength(4)

    await Promise.all(pending)
  })

  it('blocks a cross-origin navigation attempt, allowing a same-origin one', async () => {
    await renderWithHiddenWindow('https://example.com/spa', { settleMs: 0 })
    const window = FakeBrowserWindow.instances[0] as unknown as FakeBrowserWindow

    const navigateCall = window.webContents.on.mock.calls.find(([name]) => name === 'will-navigate')
    const redirectCall = window.webContents.on.mock.calls.find(([name]) => name === 'will-redirect')
    expect(navigateCall).toBeDefined()
    expect(redirectCall).toBeDefined()

    const handler = navigateCall?.[1] as (
      event: { preventDefault: () => void },
      url: string,
    ) => void
    const allowed = { preventDefault: vi.fn() }
    handler(allowed, 'https://example.com/other-page')
    expect(allowed.preventDefault).not.toHaveBeenCalled()

    const blocked = { preventDefault: vi.fn() }
    handler(blocked, 'http://192.168.1.1/admin')
    expect(blocked.preventDefault).toHaveBeenCalledOnce()
  })

  it('rejects when the rendered page is not a string at all (a page that redefined outerHTML)', async () => {
    class NonStringWindow extends FakeBrowserWindow {
      override webContents = {
        setWindowOpenHandler: vi.fn(),
        // biome-ignore lint/suspicious/noExplicitAny: deliberately the wrong type
        executeJavaScript: vi.fn(async (): Promise<any> => ({ not: 'a string' })),
        on: vi.fn(),
      }
    }
    vi.doMock('electron', () => ({ BrowserWindow: NonStringWindow, session: { fromPartition } }))
    vi.resetModules()
    const { renderWithHiddenWindow: renderNonString } = await import('./spa-render')

    await expect(renderNonString('https://example.com/spa', { settleMs: 0 })).rejects.toThrow(
      /not a string/,
    )
  })

  it('destroys the window before clearing session storage, not after', async () => {
    const order: string[] = []
    class OrderedWindow extends FakeBrowserWindow {
      override destroy() {
        order.push('destroy')
        super.destroy()
      }
    }
    const orderedSession = () => ({
      ...makeFakeSession('ordered'),
      clearStorageData: vi.fn(async () => {
        order.push('clearStorageData')
      }),
    })
    const orderedFromPartition = vi.fn(orderedSession)
    vi.doMock('electron', () => ({
      BrowserWindow: OrderedWindow,
      session: { fromPartition: orderedFromPartition },
    }))
    vi.resetModules()
    const { renderWithHiddenWindow: renderOrdered } = await import('./spa-render')

    await renderOrdered('https://example.com/spa', { settleMs: 0 })

    expect(order).toEqual(['destroy', 'clearStorageData'])
  })

  it('gives each render its own session partition rather than sharing one', async () => {
    await renderWithHiddenWindow('https://example.com/first', { settleMs: 0 })
    await renderWithHiddenWindow('https://example.com/second', { settleMs: 0 })

    expect(fromPartition).toHaveBeenCalledTimes(2)
    const [firstPartition] = fromPartition.mock.calls[0] as [string]
    const [secondPartition] = fromPartition.mock.calls[1] as [string]
    expect(firstPartition).not.toBe(secondPartition)
  })

  describe('the subresource guard', () => {
    // No mocking of `./url-safety`: every case below is decided by its literal IP alone
    // (`assertPublicHostname`'s synchronous branch), so the real implementation runs and
    // never touches DNS — proving the actual guard is wired in, not a stand-in for it.

    it('cancels a request to a private address, over plain http', async () => {
      await renderWithHiddenWindow('https://example.com/spa', { settleMs: 0 })
      const scrapeSession = fromPartition.mock.results[0]?.value as ReturnType<
        typeof makeFakeSession
      >

      await expect(
        askBeforeRequest(scrapeSession, 'http://192.168.1.1/pixel.png'),
      ).resolves.toEqual({ cancel: true })
    })

    it('cancels a request to the cloud metadata address', async () => {
      await renderWithHiddenWindow('https://example.com/spa', { settleMs: 0 })
      const scrapeSession = fromPartition.mock.results[0]?.value as ReturnType<
        typeof makeFakeSession
      >

      await expect(
        askBeforeRequest(scrapeSession, 'http://169.254.169.254/latest/meta-data/'),
      ).resolves.toEqual({ cancel: true })
    })

    it('cancels a WebSocket to a private address — not just http(s)', async () => {
      await renderWithHiddenWindow('https://example.com/spa', { settleMs: 0 })
      const scrapeSession = fromPartition.mock.results[0]?.value as ReturnType<
        typeof makeFakeSession
      >

      await expect(askBeforeRequest(scrapeSession, 'ws://10.0.0.5:8080/')).resolves.toEqual({
        cancel: true,
      })
    })

    it('allows a request to a public address', async () => {
      await renderWithHiddenWindow('https://example.com/spa', { settleMs: 0 })
      const scrapeSession = fromPartition.mock.results[0]?.value as ReturnType<
        typeof makeFakeSession
      >

      await expect(askBeforeRequest(scrapeSession, 'https://8.8.8.8/api')).resolves.toEqual({
        cancel: false,
      })
    })

    it('leaves a non-networked scheme alone — an inline image has nothing to guard', async () => {
      await renderWithHiddenWindow('https://example.com/spa', { settleMs: 0 })
      const scrapeSession = fromPartition.mock.results[0]?.value as ReturnType<
        typeof makeFakeSession
      >

      await expect(askBeforeRequest(scrapeSession, 'data:image/png;base64,AAAA')).resolves.toEqual({
        cancel: false,
      })
    })
  })
})
