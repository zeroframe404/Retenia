import type { Settings, UpdateStatus } from '@retenia/ipc-contract'
// `electron-updater` ships CJS-only and exposes `autoUpdater` through a lazy getter
// (`Object.defineProperty(exports, 'autoUpdater', { get() {...} })`), which Node's
// ESM/CJS interop cannot always statically resolve as a named export — this is left
// external by `electron-vite` (see electron.vite.config.ts), so it's the real installed
// package Node loads at runtime, not a Vite-bundled reinterpretation of it. Importing the
// module's default and destructuring off it is the interop-safe form either way.
import electronUpdater from 'electron-updater'
import { log } from '../logging/log'

const { autoUpdater } = electronUpdater

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
 * every 6 hours after that, and leaves the actual restart to `app.quitAndInstall` so the
 * renderer can ask the user first.
 *
 * `autoDownload` is off, not on: `verifyUpdateCodeSignature` in electron-builder.yml has
 * nothing to check a download against until sub-phase 14.3 ships a real code-signing
 * certificate, so today's installer is unsigned, and silently downloading + offering to
 * install an unsigned binary within 6h of a compromised or mistaken release-channel write
 * is not a risk worth taking before then. Checking (and the `checking`/`available`/`error`
 * status events) still happens on the normal schedule either way — only the download step
 * is held back, pending an explicit `autoUpdater.downloadUpdate()` call this app doesn't
 * make yet. Flip this to `true` in the same change that wires up signing.
 */
export function createUpdater({ getChannel, onStatus, enabled }: UpdaterOptions): Updater {
  autoUpdater.autoDownload = false
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
    const channel = getChannel()
    autoUpdater.channel = channel
    // `channel` alone only picks which `<channel>.yml` feed file to read; a prerelease
    // version in that feed is still skipped unless `allowPrerelease` is also set.
    autoUpdater.allowPrerelease = channel !== 'latest'
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
