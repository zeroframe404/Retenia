import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { contract, type DeepLink } from '@retenia/ipc-contract'
import * as Sentry from '@sentry/electron/main'
import type { OpenDialogOptions } from 'electron'
import { app, dialog, protocol } from 'electron'
import {
  createBackupService,
  shouldRunDailyBackup,
  shouldRunWeeklyIntegrityCheck,
  swapInBackup,
} from './backups/service'
import { isPathInSyncedFolder } from './backups/synced-folder'
import { createFsBlobStore } from './blobs/store'
import { parseDeepLink } from './deep-links/parse'
import { deepLinkFromArgv, registerDeepLinks } from './deep-links/register'
import { createHandlers } from './ipc/handlers'
import { registerHandlers } from './ipc/register-handlers'
import { makeSenderGuard } from './ipc/sender'
import { bootstrapJobs } from './jobs/bootstrap'
import { initLogging, log } from './logging/log'
import { initSentryMain } from './observability/sentry'
import { getBackupsRoot, getBlobsRoot, getDatabasePath, getSettingsPath } from './paths'
import { APP_SCHEME_PRIVILEGES, handleAppProtocol } from './protocol/app-protocol'
import { handleMediaProtocol, MEDIA_SCHEME_PRIVILEGES } from './protocol/media-protocol'
import { createSecretStore } from './secrets/store'
import { applySecurity } from './security/apply'
import { buildCsp } from './security/csp'
import { allowedRendererOrigins } from './security/origins'
import { SettingsStore } from './settings/store'
import { initThemeSync } from './theme/sync'
import { createUpdater } from './updates/updater'
import { broadcast, getWindows, openWindow, WindowKind } from './windows/manager'

// Before anything else: file logging has to exist before the first `log.error`, and the
// settings file decides whether Sentry is allowed to start at all.
initLogging()
const settings = new SettingsStore(getSettingsPath())
initSentryMain(settings.get().telemetryEnabled)

const preloadPath = join(__dirname, '../preload/index.cjs')

/**
 * A deep link that arrives before the main window can display it (cold start, or the
 * window is still mid-navigation) waits here until `did-finish-load` flushes it.
 */
let pendingDeepLink: DeepLink | null = null

function deliverDeepLink(link: DeepLink): void {
  const [main] = getWindows(WindowKind.Main)
  if (main && !main.webContents.isLoadingMainFrame()) {
    broadcast('app.deepLink', link)
  } else {
    pendingDeepLink = link
  }
}

// Must run before `app.whenReady()`: a second launch has to be caught immediately, and
// `retenia://` has to be registered before the OS can hand the app a link to it.
const gotLock = registerDeepLinks({
  onDeepLink: deliverDeepLink,
  onSecondInstance: () => {
    const [main] = getWindows(WindowKind.Main)
    if (!main) return
    if (main.isMinimized()) main.restore()
    main.focus()
  },
})

if (gotLock) {
  // On Windows, launching the app via `retenia://…` starts a fresh process with the URL in
  // its own argv — there is no earlier instance for `second-instance` to notify.
  const argvLink = deepLinkFromArgv(process.argv)
  if (argvLink) {
    const parsed = parseDeepLink(argvLink)
    if (parsed) {
      pendingDeepLink = parsed
    }
  }

  // Must also run before `app.whenReady()`: privileges are read the first time a scheme is
  // used. Both schemes are registered in one call — Electron writes scheme privileges to
  // renderer command-line switches by *overwrite*, not append, so two separate calls would
  // silently strip `secure`/`supportFetchAPI`/`corsEnabled` from whichever scheme is not
  // registered last, leaving `app://` an insecure context.
  protocol.registerSchemesAsPrivileged([APP_SCHEME_PRIVILEGES, MEDIA_SCHEME_PRIVILEGES])

  const devServerUrl = is.dev ? process.env.ELECTRON_RENDERER_URL : undefined
  const allowedOrigins = allowedRendererOrigins(devServerUrl)
  // `is.dev` is `!app.isPackaged`, true for any unpackaged run — including one that serves
  // the real `app://` renderer. So the relaxation is keyed off the dev server actually
  // being in use, and the `app://` handler always gets the strict policy.
  //
  // Both are functions, not precomputed strings: the provider allowlist `buildCsp` reads
  // is meant to come from settings (sub-phase 7.x), which can change without a relaunch,
  // and a closed-over string could never reflect that.
  const getCsp = () => buildCsp({ devServerUrl })
  const getAppProtocolCsp = () => buildCsp()

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('app.retenia.desktop')

    handleAppProtocol(join(__dirname, '../renderer'), getAppProtocolCsp)
    handleMediaProtocol(getBlobsRoot())
    applySecurity({ allowedOrigins, getCsp })

    const updater = createUpdater({
      getChannel: () => settings.get().updateChannel,
      onStatus: (status) => broadcast('app.updateStatus', status),
      // No `app-update.yml` in an unpackaged build for electron-updater to read — checking
      // there only produces noise (and, over the dev server, occasional real errors).
      //
      // Also stays off in every packaged build until the release pipeline explicitly opts
      // in with RETENIA_UPDATES_ENABLED=1: `verifyUpdateCodeSignature` in
      // electron-builder.yml has nothing to check against until sub-phase 14.3 ships a real
      // code-signing certificate, so today's installer is unsigned. Silently downloading
      // and installing an unsigned binary within 6h of a compromised or mistaken
      // release-channel write is not a risk worth taking before signing lands
      // (docs/spec/07-architecture.md §4).
      enabled: !is.dev && process.env.RETENIA_UPDATES_ENABLED === '1',
    })
    app.on('before-quit', () => updater.stop())

    const stopThemeSync = initThemeSync(settings.get().theme, (theme) =>
      broadcast('app.themeChanged', { theme }),
    )
    app.on('before-quit', () => stopThemeSync())

    const jobs = bootstrapJobs({
      deviceId: settings.deviceId,
      emit: (event) => broadcast('jobs.progress', event),
      // Same gate as `app.devMediaSampleUrl`: nothing in the shipped product enqueues from
      // the renderer, so the demo channel refuses outside a dev run or the e2e suite.
      demoEnabled: is.dev || process.env.RETENIA_E2E === '1',
    })

    // Settings, blobs, secrets and backups all read and write through the one connection
    // `bootstrapJobs` opened — `jobs.stop()` is what closes it. `database` is `null` only
    // when that connection never opened, in which case every one of these degrades the
    // same way the job queue does (`../jobs/bootstrap.ts`'s `unavailableFacade`).
    const database = jobs.database
    const dbUnavailableReason = 'see the earlier "[jobs] the database did not open" log line'
    const blobStore = createFsBlobStore(getBlobsRoot())
    const secretStore = database ? createSecretStore(database.repos.settings) : null
    const backupService = database
      ? createBackupService({
          sqlite: database.opened.sqlite,
          backupsRoot: getBackupsRoot(),
          blobsRoot: getBlobsRoot(),
        })
      : null
    const syncedFolderWarning = isPathInSyncedFolder(app.getPath('userData'))
    if (syncedFolderWarning) {
      log.warn(
        '[backups] userData is inside what looks like a cloud-synced folder ' +
          '(OneDrive/Dropbox/Google Drive); this can corrupt the database ' +
          '(docs/spec/07-architecture.md §11).',
      )
    }

    if (database && backupService) {
      // Daily backup + weekly integrity check, both checked once per launch rather than on
      // a timer: a desktop app is not expected to stay open across the boundary, and
      // "on quit" (below) already covers the common case of a session that does.
      void (async () => {
        try {
          const lastBackupAt = await database.repos.settings.getRaw('backups.lastBackupAt')
          if (
            shouldRunDailyBackup(typeof lastBackupAt === 'string' ? lastBackupAt : null, new Date())
          ) {
            await backupService.backupNow()
            await database.repos.settings.setRaw('backups.lastBackupAt', new Date().toISOString())
          }
          const lastCheckAt = await database.repos.settings.getRaw('backups.lastIntegrityCheckAt')
          if (
            shouldRunWeeklyIntegrityCheck(
              typeof lastCheckAt === 'string' ? lastCheckAt : null,
              new Date(),
            )
          ) {
            const result = backupService.runIntegrityCheck()
            if (result !== 'ok') {
              log.error('[backups] weekly integrity_check found problems:', result)
            }
            await database.repos.settings.setRaw(
              'backups.lastIntegrityCheckAt',
              new Date().toISOString(),
            )
          }
        } catch (error) {
          log.error('[backups] the startup backup/integrity check failed:', error)
        }
      })()
    }

    app.on('before-quit', () => {
      if (!backupService) return
      void backupService.backupNow().catch((error: unknown) => {
        log.error('[backups] the on-quit backup failed:', error)
      })
    })

    /** Prompts for a `.db` backup file, closes the shared database, swaps it in, and
     *  relaunches. Returns `false` (without touching anything) when the user cancels. */
    async function restoreFromBackupAndRelaunch(): Promise<boolean> {
      if (!database) return false
      const [window] = getWindows(WindowKind.Main)
      const dialogOptions: OpenDialogOptions = {
        title: 'Restore from backup',
        filters: [{ name: 'Retenia backup', extensions: ['db'] }],
        properties: ['openFile'],
      }
      const { canceled, filePaths } = window
        ? await dialog.showOpenDialog(window, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      const backupFile = filePaths[0]
      if (canceled || !backupFile) return false

      await jobs.stop()
      await swapInBackup(backupFile, getDatabasePath())
      app.relaunch()
      app.exit(0)
      return true
    }

    const handlers = createHandlers({
      settings,
      updater,
      jobs: jobs.facade,
      blobStore,
      secrets: secretStore,
      backups: backupService,
      settingsRepo: database ? database.repos.settings : null,
      syncedFolderWarning,
      restoreFromBackup: restoreFromBackupAndRelaunch,
      dbUnavailableReason,
      emitSettingsChanged: (key, value) => broadcast('settings.changed', { key, value }),
      reportRendererError: (error) => {
        log.error('[renderer]', error.name, error.message, error.stack)
        // Re-checked per call rather than captured once at startup: `Sentry.init` only
        // runs once (a toggle takes full effect on the next launch), but a report that
        // arrives after the user turns telemetry off should still not be sent anywhere.
        if (!settings.get().telemetryEnabled) return
        const forwarded = new Error(error.message)
        forwarded.name = error.name
        if (error.stack) forwarded.stack = error.stack
        Sentry.captureException(forwarded)
      },
    })
    registerHandlers(contract, handlers, { isAllowedSender: makeSenderGuard(allowedOrigins) })

    // Orphan recovery runs inside `start`, before any worker can claim: everything still
    // marked `running` belongs to the process that died.
    void jobs.start().catch((error: unknown) => {
      log.error('[jobs] the runner failed to start:', error)
    })
    app.on('before-quit', () => {
      void jobs.stop()
    })

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    const main = openWindow(WindowKind.Main, {}, { devServerUrl, preloadPath })
    main.webContents.once('did-finish-load', () => {
      if (pendingDeepLink) {
        broadcast('app.deepLink', pendingDeepLink)
        pendingDeepLink = null
      }
    })

    // Headless verification (no display) greps stdout for this line.
    console.log('ready')

    app.on('activate', () => {
      if (getWindows(WindowKind.Main).length === 0) {
        openWindow(WindowKind.Main, {}, { devServerUrl, preloadPath })
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
