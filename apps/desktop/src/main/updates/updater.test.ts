import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (...args: unknown[]) => void

class FakeAutoUpdater {
  autoDownload = false
  autoInstallOnAppQuit = true
  allowPrerelease = false
  logger: unknown
  channel: string | null = null
  checkForUpdates = vi.fn(async () => null)
  quitAndInstall = vi.fn()
  private listeners = new Map<string, Listener[]>()

  on(event: string, listener: Listener) {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
    return this
  }

  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

const autoUpdater = new FakeAutoUpdater()

vi.mock('electron-updater', () => ({ autoUpdater, default: { autoUpdater } }))
vi.mock('../logging/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { createUpdater } = await import('./updater')

beforeEach(() => {
  vi.useFakeTimers()
  autoUpdater.checkForUpdates.mockClear()
  autoUpdater.quitAndInstall.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createUpdater', () => {
  it('configures autoUpdater for auto-download with a user-confirmed install', () => {
    createUpdater({ getChannel: () => 'latest', onStatus: vi.fn(), enabled: false })
    expect(autoUpdater.autoDownload).toBe(true)
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false)
  })

  it('does not schedule any checks when disabled (dev)', () => {
    createUpdater({ getChannel: () => 'latest', onStatus: vi.fn(), enabled: false })
    vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 10_000)
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('checks 10s after launch, then every 6h, reading the channel each time', () => {
    let channel: 'latest' | 'beta' = 'latest'
    createUpdater({ getChannel: () => channel, onStatus: vi.fn(), enabled: true })

    vi.advanceTimersByTime(10_000)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(autoUpdater.channel).toBe('latest')

    channel = 'beta'
    vi.advanceTimersByTime(6 * 60 * 60 * 1000)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(autoUpdater.channel).toBe('beta')
  })

  it('stop() clears both timers', () => {
    const updater = createUpdater({ getChannel: () => 'latest', onStatus: vi.fn(), enabled: true })
    updater.stop()
    vi.advanceTimersByTime(7 * 60 * 60 * 1000)
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('maps every autoUpdater event to the contract status shape', () => {
    const onStatus = vi.fn()
    createUpdater({ getChannel: () => 'latest', onStatus, enabled: false })

    autoUpdater.emit('checking-for-update')
    expect(onStatus).toHaveBeenLastCalledWith({ status: 'checking' })

    autoUpdater.emit('update-not-available')
    expect(onStatus).toHaveBeenLastCalledWith({ status: 'not-available' })

    autoUpdater.emit('update-available', { version: '0.4.0' })
    expect(onStatus).toHaveBeenLastCalledWith({ status: 'available', version: '0.4.0' })

    autoUpdater.emit('download-progress', { percent: 42.6 })
    expect(onStatus).toHaveBeenLastCalledWith({ status: 'downloading', percent: 43 })

    autoUpdater.emit('update-downloaded', { version: '0.4.0' })
    expect(onStatus).toHaveBeenLastCalledWith({ status: 'downloaded', version: '0.4.0' })

    autoUpdater.emit('error', new Error('offline'))
    expect(onStatus).toHaveBeenLastCalledWith({ status: 'error', message: 'offline' })
  })

  it('quitAndInstall delegates to autoUpdater', () => {
    const updater = createUpdater({ getChannel: () => 'latest', onStatus: vi.fn(), enabled: false })
    updater.quitAndInstall()
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledOnce()
  })

  it('checkForUpdates can be triggered manually', () => {
    const updater = createUpdater({ getChannel: () => 'beta', onStatus: vi.fn(), enabled: false })
    updater.checkForUpdates()
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce()
    expect(autoUpdater.channel).toBe('beta')
  })

  it('only allows a prerelease version on the beta channel', () => {
    const updater = createUpdater({ getChannel: () => 'latest', onStatus: vi.fn(), enabled: false })
    updater.checkForUpdates()
    expect(autoUpdater.allowPrerelease).toBe(false)

    const betaUpdater = createUpdater({
      getChannel: () => 'beta',
      onStatus: vi.fn(),
      enabled: false,
    })
    betaUpdater.checkForUpdates()
    expect(autoUpdater.allowPrerelease).toBe(true)
  })
})
