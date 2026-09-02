import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerDeps } from './handlers'

const app = { getVersion: () => '0.1.0' }
const showSaveDialog = vi.fn()
const fromWebContents = vi.fn()
const nativeTheme = { themeSource: 'system' }

vi.mock('electron', () => ({
  app,
  BrowserWindow: { fromWebContents },
  dialog: { showSaveDialog },
  nativeTheme,
}))

let devMode = false
vi.mock('@electron-toolkit/utils', () => ({
  get is() {
    return { dev: devMode }
  },
}))

const ensureDevMediaSample = vi.fn(() => 'media://blob/sample.ogg')
vi.mock('../dev/media-sample', () => ({ ensureDevMediaSample }))

const collectSystemInfo = vi.fn(async () => ({ appVersion: '0.1.0' }))
const exportDiagnostics = vi.fn(async () => {})
vi.mock('../diagnostics/export', () => ({ collectSystemInfo, exportDiagnostics }))

vi.mock('../paths', () => ({
  getBlobsRoot: () => '/userData/blobs',
  getDevMediaSamplePath: () => '/resources/dev/sample.ogg',
  getLogsDir: () => '/userData/logs',
}))

const { createHandlers } = await import('./handlers')

function makeDeps(): HandlerDeps {
  return {
    settings: {
      get: vi.fn(() => ({
        updateChannel: 'latest' as const,
        telemetryEnabled: false,
        theme: 'system' as const,
      })),
      setUpdateChannel: vi.fn((channel: 'latest' | 'beta') => ({
        updateChannel: channel,
        telemetryEnabled: false,
        theme: 'system' as const,
      })),
      setTelemetryEnabled: vi.fn((enabled: boolean) => ({
        updateChannel: 'latest' as const,
        telemetryEnabled: enabled,
        theme: 'system' as const,
      })),
      setTheme: vi.fn((theme: 'light' | 'dark' | 'system') => ({
        updateChannel: 'latest' as const,
        telemetryEnabled: false,
        theme,
      })),
    } as unknown as HandlerDeps['settings'],
    updater: {
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn(),
      stop: vi.fn(),
    },
    reportRendererError: vi.fn(),
  }
}

const fakeEvent = { sender: {} } as Parameters<
  ReturnType<typeof createHandlers>['app.exportDiagnostics']
>[1]

beforeEach(() => {
  devMode = false
  showSaveDialog.mockReset()
  fromWebContents.mockReset()
  ensureDevMediaSample.mockClear()
  collectSystemInfo.mockClear()
  exportDiagnostics.mockClear()
})

describe('app.getSettings / setUpdateChannel / setTelemetryEnabled / setTheme', () => {
  it('delegates straight to the settings store', () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)

    expect(handlers['app.getSettings'](undefined, fakeEvent)).toEqual(deps.settings.get())
    expect(handlers['app.setUpdateChannel']({ channel: 'beta' }, fakeEvent)).toEqual({
      updateChannel: 'beta',
      telemetryEnabled: false,
      theme: 'system',
    })
    expect(handlers['app.setTelemetryEnabled']({ enabled: true }, fakeEvent)).toEqual({
      updateChannel: 'latest',
      telemetryEnabled: true,
      theme: 'system',
    })
  })

  it('sets nativeTheme.themeSource and persists the preference', () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)

    expect(handlers['app.setTheme']({ theme: 'dark' }, fakeEvent)).toEqual({
      updateChannel: 'latest',
      telemetryEnabled: false,
      theme: 'dark',
    })
    expect(nativeTheme.themeSource).toBe('dark')
    expect(deps.settings.setTheme).toHaveBeenCalledWith('dark')
  })
})

describe('app.checkForUpdates / app.quitAndInstall', () => {
  it('delegates to the updater', () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)

    handlers['app.checkForUpdates'](undefined, fakeEvent)
    expect(deps.updater.checkForUpdates).toHaveBeenCalledOnce()

    handlers['app.quitAndInstall'](undefined, fakeEvent)
    expect(deps.updater.quitAndInstall).toHaveBeenCalledOnce()
  })
})

describe('app.exportDiagnostics', () => {
  it('returns savedTo: null when the user cancels the save dialog', async () => {
    fromWebContents.mockReturnValue(null)
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
    const handlers = createHandlers(makeDeps())

    const result = await handlers['app.exportDiagnostics'](undefined, fakeEvent)

    expect(result).toEqual({ savedTo: null })
    expect(exportDiagnostics).not.toHaveBeenCalled()
  })

  it('zips the logs to the chosen path when a window owns the request', async () => {
    const window = { id: 1 }
    fromWebContents.mockReturnValue(window)
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/diagnostics.zip' })
    const handlers = createHandlers(makeDeps())

    const result = await handlers['app.exportDiagnostics'](undefined, fakeEvent)

    expect(showSaveDialog).toHaveBeenCalledWith(window, expect.any(Object))
    expect(collectSystemInfo).toHaveBeenCalledOnce()
    expect(exportDiagnostics).toHaveBeenCalledWith(
      '/userData/logs',
      { appVersion: '0.1.0' },
      '/tmp/diagnostics.zip',
    )
    expect(result).toEqual({ savedTo: '/tmp/diagnostics.zip' })
  })

  it('falls back to the dialog-only overload when no window owns the request', async () => {
    fromWebContents.mockReturnValue(null)
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/diagnostics.zip' })
    const handlers = createHandlers(makeDeps())

    await handlers['app.exportDiagnostics'](undefined, fakeEvent)

    expect(showSaveDialog).toHaveBeenCalledWith(expect.any(Object))
  })
})

describe('app.reportRendererError', () => {
  it('forwards the error as-is', () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)
    const error = { name: 'TypeError', message: 'boom', stack: 'at x' }

    handlers['app.reportRendererError'](error, fakeEvent)

    expect(deps.reportRendererError).toHaveBeenCalledWith(error)
  })
})

describe('app.devMediaSampleUrl', () => {
  it('returns null outside dev', () => {
    devMode = false
    const handlers = createHandlers(makeDeps())
    expect(handlers['app.devMediaSampleUrl'](undefined, fakeEvent)).toEqual({ url: null })
    expect(ensureDevMediaSample).not.toHaveBeenCalled()
  })

  it('copies the sample into the blob store in dev', () => {
    devMode = true
    const handlers = createHandlers(makeDeps())
    expect(handlers['app.devMediaSampleUrl'](undefined, fakeEvent)).toEqual({
      url: 'media://blob/sample.ogg',
    })
    expect(ensureDevMediaSample).toHaveBeenCalledWith(
      '/resources/dev/sample.ogg',
      '/userData/blobs',
    )
  })
})
