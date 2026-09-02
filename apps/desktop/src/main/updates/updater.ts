import type { Settings, UpdateStatus } from '@retenia/ipc-contract'
import { autoUpdater } from 'electron-updater'
import { log } from '../logging/log'

const LAUNCH_CHECK_DELAY_MS = 10_000
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface UpdaterOptions {
  /** Reads the current channel on every check, so a setting change takes effect on the
   * next scheduled check without restarting the updater. */
  getChannel: () => Settings['updateChannel']
  onStatus: (status: UpdateStatus) => void
  /** Skips wiring the timers; auto-update has nothing to check against in dev (no packaged
   * `app-update.yml`) and would otherwise error on every launch. */
  enabled: boolean
}

export interface Updater {
  checkForUpdates: () => void
  quitAndInstall: () => void
  stop: () => void
}

/**
 * Wraps `electron-updater`'s `autoUpdater` (docs/spec/07-architecture.md §4/§10): checks
 * on launch (after a short delay so it never competes with the window's first paint) and
 * every 6 hours after that, downloads automatically, and leaves the actual restart to
 * `app.quitAndInstall` so the renderer can ask the user first.
 */
export function createUpdater({ getChannel, onStatus, enabled }: UpdaterOptions): Updater {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = log

  autoUpdater.on('checking-for-update', () => onStatus({ status: 'checking' }))
  autoUpdater.on('update-not-available', () => onStatus({ status: 'not-available' }))
  autoUpdater.on('update-available', (info) =>
    onStatus({ status: 'available', version: info.version }),
  )
  autoUpdater.on('download-progress', (progress) =>
    onStatus({ status: 'downloading', percent: Math.round(progress.percent) }),
  )
  autoUpdater.on('update-downloaded', (info) =>
    onStatus({ status: 'downloaded', version: info.version }),
  )
  autoUpdater.on('error', (error) => onStatus({ status: 'error', message: error.message }))

  const checkForUpdates = () => {
    autoUpdater.channel = getChannel()
    autoUpdater.checkForUpdates().catch((error: unknown) => {
      log.error('[updater] check failed', error)
    })
  }

  let interval: ReturnType<typeof setInterval> | undefined
  let launchTimer: ReturnType<typeof setTimeout> | undefined

  if (enabled) {
    launchTimer = setTimeout(checkForUpdates, LAUNCH_CHECK_DELAY_MS)
    interval = setInterval(checkForUpdates, RECHECK_INTERVAL_MS)
  }

  return {
    checkForUpdates,
    quitAndInstall: () => autoUpdater.quitAndInstall(),
    stop: () => {
      clearTimeout(launchTimer)
      clearInterval(interval)
    },
  }
}
