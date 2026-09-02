import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { contract, type DeepLink } from '@retenia/ipc-contract'
import * as Sentry from '@sentry/electron/main'
import { app } from 'electron'
import { parseDeepLink } from './deep-links/parse'
import { deepLinkFromArgv, registerDeepLinks } from './deep-links/register'
import { createHandlers } from './ipc/handlers'
import { registerHandlers } from './ipc/register-handlers'
import { makeSenderGuard } from './ipc/sender'
import { initLogging, log } from './logging/log'
import { initSentryMain } from './observability/sentry'
import { getBlobsRoot, getSettingsPath } from './paths'
import { handleAppProtocol, registerAppScheme } from './protocol/app-protocol'
import { handleMediaProtocol, registerMediaScheme } from './protocol/media-protocol'
import { applySecurity } from './security/apply'
import { buildCsp } from './security/csp'
import { allowedRendererOrigins } from './security/origins'
import { SettingsStore } from './settings/store'
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
  // used.
  registerAppScheme()
  registerMediaScheme()

  const devServerUrl = is.dev ? process.env.ELECTRON_RENDERER_URL : undefined
  const allowedOrigins = allowedRendererOrigins(devServerUrl)
  // `is.dev` is `!app.isPackaged`, true for any unpackaged run — including one that serves
  // the real `app://` renderer. So the relaxation is keyed off the dev server actually
  // being in use, and the `app://` handler always gets the strict policy.
  const csp = buildCsp({ devServerUrl })
  const appProtocolCsp = buildCsp()

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('app.retenia.desktop')

    handleAppProtocol(join(__dirname, '../renderer'), appProtocolCsp)
    handleMediaProtocol(getBlobsRoot())
    applySecurity({ allowedOrigins, csp })

    const updater = createUpdater({
      getChannel: () => settings.get().updateChannel,
      onStatus: (status) => broadcast('app.updateStatus', status),
      // No `app-update.yml` in an unpackaged build for electron-updater to read — checking
      // there only produces noise (and, over the dev server, occasional real errors).
      enabled: !is.dev,
    })
    app.on('before-quit', () => updater.stop())

    const handlers = createHandlers({
      settings,
      updater,
      reportRendererError: (error) => {
        log.error('[renderer]', error.name, error.message, error.stack)
        const forwarded = new Error(error.message)
        forwarded.name = error.name
        if (error.stack) forwarded.stack = error.stack
        Sentry.captureException(forwarded)
      },
    })
    registerHandlers(contract, handlers, { isAllowedSender: makeSenderGuard(allowedOrigins) })

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
