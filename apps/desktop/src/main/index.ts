import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { contract } from '@retenia/ipc-contract'
import { app, BrowserWindow } from 'electron'
import { handlers } from './ipc/handlers'
import { registerHandlers } from './ipc/register-handlers'
import { makeSenderGuard } from './ipc/sender'
import { handleAppProtocol, registerAppScheme } from './protocol/app-protocol'
import { applySecurity } from './security/apply'
import { buildCsp } from './security/csp'
import { APP_INDEX_URL, allowedRendererOrigins } from './security/origins'

// Must run before `app.whenReady()`: privileges are read when the scheme is first used.
registerAppScheme()

const devServerUrl = is.dev ? process.env.ELECTRON_RENDERER_URL : undefined
const allowedOrigins = allowedRendererOrigins(devServerUrl)
// `is.dev` is `!app.isPackaged`, which is true for any unpackaged run — including one
// that serves the real `app://` renderer. So the relaxation is keyed off the dev server
// actually being in use, and the `app://` handler is given the strict policy regardless.
const csp = buildCsp({ devServerUrl })
const appProtocolCsp = buildCsp()

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    title: 'Retenia',
    width: 1100,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      // A sandboxed preload cannot be an ES module, hence `.cjs` (see electron.vite.config.ts).
      preload: join(__dirname, '../preload/index.cjs'),
      // Non-negotiable per CLAUDE.md and docs/spec/07-architecture.md §4.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      webviewTag: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    // `app://`, never `file://`: the renderer needs a real origin for CSP and for the
    // sender checks on every IPC message.
    void mainWindow.loadURL(APP_INDEX_URL)
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('app.retenia.desktop')

  handleAppProtocol(join(__dirname, '../renderer'), appProtocolCsp)
  applySecurity({ allowedOrigins, csp })
  registerHandlers(contract, handlers, { isAllowedSender: makeSenderGuard(allowedOrigins) })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  // Headless verification (no display) greps stdout for this line.
  console.log('ready')

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
