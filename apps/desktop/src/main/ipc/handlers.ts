import { is } from '@electron-toolkit/utils'
import type { Contract } from '@retenia/ipc-contract'
import { app, BrowserWindow, dialog } from 'electron'
import { ensureDevMediaSample } from '../dev/media-sample'
import { collectSystemInfo, exportDiagnostics } from '../diagnostics/export'
import { getBlobsRoot, getDevMediaSamplePath, getLogsDir } from '../paths'
import type { SettingsStore } from '../settings/store'
import type { Updater } from '../updates/updater'
import type { Handlers } from './register-handlers'

export interface HandlerDeps {
  settings: SettingsStore
  updater: Updater
  /** Forwarded to the main-process Sentry client, once telemetry is on. */
  reportRendererError: (error: { name: string; message: string; stack?: string }) => void
}

/** The implementation of every channel in the contract. */
export function createHandlers({
  settings,
  updater,
  reportRendererError,
}: HandlerDeps): Handlers<Contract> {
  return {
    'app.getVersion': () => ({
      app: app.getVersion(),
      electron: process.versions.electron ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      node: process.versions.node ?? 'unknown',
    }),

    'app.ping': ({ sentAt }) => ({
      sentAt,
      receivedAt: new Date().toISOString(),
    }),

    'app.devMediaSampleUrl': () => {
      if (!is.dev) {
        return { url: null }
      }
      return { url: ensureDevMediaSample(getDevMediaSamplePath(), getBlobsRoot()) }
    },

    'app.getSettings': () => settings.get(),

    'app.setUpdateChannel': ({ channel }) => settings.setUpdateChannel(channel),

    'app.setTelemetryEnabled': ({ enabled }) => settings.setTelemetryEnabled(enabled),

    'app.checkForUpdates': () => {
      updater.checkForUpdates()
    },

    'app.quitAndInstall': () => {
      updater.quitAndInstall()
    },

    'app.exportDiagnostics': async (_input, event) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions = {
        title: 'Export diagnostics',
        defaultPath: `retenia-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
        filters: [{ name: 'Zip archive', extensions: ['zip'] }],
      }
      const { canceled, filePath } = window
        ? await dialog.showSaveDialog(window, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)
      if (canceled || !filePath) {
        return { savedTo: null }
      }
      const systemInfo = await collectSystemInfo()
      await exportDiagnostics(getLogsDir(), systemInfo, filePath)
      return { savedTo: filePath }
    },

    'app.reportRendererError': (error) => {
      reportRendererError(error)
    },
  }
}
