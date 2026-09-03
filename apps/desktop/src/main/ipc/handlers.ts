import { is } from '@electron-toolkit/utils'
import type {
  BlobStore,
  JsonValue,
  SecretName,
  SecretStore,
  SettingsKey,
  SettingsRepository,
} from '@retenia/core'
import { SETTINGS } from '@retenia/core'
import type { Contract } from '@retenia/ipc-contract'
import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import type { BackupService } from '../backups/service'
import { ensureDevMediaSample } from '../dev/media-sample'
import { collectSystemInfo, exportDiagnostics } from '../diagnostics/export'
import type { JobsFacade } from '../jobs/facade'
import { getDevMediaSamplePath, getLogsDir } from '../paths'
import { maskSecret } from '../secrets/store'
import type { SettingsStore } from '../settings/store'
import type { Updater } from '../updates/updater'
import type { Handlers } from './register-handlers'

/** What a subsystem that depends on the database looks like once it failed to open — every
 *  handler in its domain reports why instead of pretending to work (same pattern as
 *  `../jobs/bootstrap.ts`'s `unavailableFacade`). */
function unavailable(domain: string, reason: string): never {
  throw new Error(`${domain} is unavailable: the database did not open (${reason})`)
}

export interface HandlerDeps {
  settings: SettingsStore
  updater: Updater
  jobs: JobsFacade
  blobStore: BlobStore
  /** Forwarded to the main-process Sentry client, once telemetry is on. */
  reportRendererError: (error: { name: string; message: string; stack?: string }) => void
  /** `null` when the database did not open — see `../jobs/bootstrap.ts`. */
  secrets: SecretStore | null
  backups: BackupService | null
  settingsRepo: SettingsRepository | null
  /** Computed once at startup (`../backups/synced-folder.ts`). */
  syncedFolderWarning: boolean
  /** Closes the shared database, swaps in the chosen backup file, and relaunches the app.
   *  Never returns under normal operation — the process exits. */
  restoreFromBackup: () => Promise<boolean>
  dbUnavailableReason: string
  /** Broadcasts `settings.changed`; what makes `useSetting` a "subscription" in practice. */
  emitSettingsChanged: (key: string, value: JsonValue) => void
}

/** The implementation of every channel in the contract. */
export function createHandlers({
  settings,
  updater,
  jobs,
  blobStore,
  reportRendererError,
  secrets,
  backups,
  settingsRepo,
  syncedFolderWarning,
  restoreFromBackup,
  dbUnavailableReason,
  emitSettingsChanged,
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

    'app.devMediaSampleUrl': async () => {
      if (!is.dev) {
        return { url: null }
      }
      return { url: await ensureDevMediaSample(getDevMediaSamplePath(), blobStore) }
    },

    'app.getSettings': () => settings.get(),

    'app.setUpdateChannel': ({ channel }) => settings.setUpdateChannel(channel),

    'app.setTelemetryEnabled': ({ enabled }) => settings.setTelemetryEnabled(enabled),

    // `nativeTheme.themeSource = …` synchronously fires the `'updated'` listener registered
    // in `main/theme/sync.ts`, which broadcasts the resolved value on `app.themeChanged` —
    // the same path an OS-level theme switch takes. So the only thing this handler owns is
    // persisting the preference.
    'app.setTheme': ({ theme }) => {
      nativeTheme.themeSource = theme
      return settings.setTheme(theme)
    },

    'app.setDensity': ({ density }) => settings.setDensity(density),

    'app.setGamificationProfile': ({ profile }) => settings.setGamificationProfile(profile),

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

    'jobs.list': async (input) => ({ jobs: await jobs.list(input) }),

    'jobs.cancel': ({ id }) => jobs.cancel(id),

    'jobs.retry': ({ id }) => jobs.retry(id),

    'jobs.enqueueDemo': (input) => jobs.enqueueDemo(input),

    'secrets.set': async ({ name, value }) => {
      if (!secrets) unavailable('secrets', dbUnavailableReason)
      await secrets.setSecret(name as SecretName, value)
      return { ok: true }
    },

    'secrets.get': async ({ name }) => {
      if (!secrets) unavailable('secrets', dbUnavailableReason)
      const value = await secrets.getSecret(name as SecretName)
      return { hasSecret: value !== undefined, preview: maskSecret(value) }
    },

    'secrets.delete': async ({ name }) => {
      if (!secrets) unavailable('secrets', dbUnavailableReason)
      await secrets.deleteSecret(name as SecretName)
      return { ok: true }
    },

    'backups.status': async () => {
      if (!backups) unavailable('backups', dbUnavailableReason)
      return { backups: await backups.list(), syncedFolderWarning }
    },

    'backups.backupNow': async () => {
      if (!backups) unavailable('backups', dbUnavailableReason)
      return { file: await backups.backupNow() }
    },

    'backups.exportCopy': async (_input, event) => {
      if (!backups) unavailable('backups', dbUnavailableReason)
      const window = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions = {
        title: 'Export a copy of your data',
        defaultPath: `retenia-export-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
        filters: [{ name: 'Zip archive', extensions: ['zip'] }],
      }
      const { canceled, filePath } = window
        ? await dialog.showSaveDialog(window, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)
      if (canceled || !filePath) {
        return { savedTo: null }
      }
      await backups.exportCopy(filePath)
      return { savedTo: filePath }
    },

    'backups.restoreFromBackup': async () => ({ restored: await restoreFromBackup() }),

    'settings.get': async ({ key }) => {
      if (!settingsRepo) unavailable('settings', dbUnavailableReason)
      if (!Object.hasOwn(SETTINGS, key)) {
        throw new Error(`settings.get: "${key}" is not a registered setting`)
      }
      return { value: await settingsRepo.get(key as SettingsKey) }
    },

    'settings.set': async ({ key, value }) => {
      if (!settingsRepo) unavailable('settings', dbUnavailableReason)
      if (!Object.hasOwn(SETTINGS, key)) {
        throw new Error(`settings.set: "${key}" is not a registered setting`)
      }
      const settingsKey = key as SettingsKey
      // The registry is heterogeneous by key; the runtime `decode` inside `set` is what
      // actually guards a bad shape (falls back to the default on the next `get`, rather
      // than crashing here).
      // biome-ignore lint/suspicious/noExplicitAny: see above.
      await settingsRepo.set(settingsKey, value as any)
      const stored = await settingsRepo.get(settingsKey)
      emitSettingsChanged(settingsKey, stored)
      return { value: stored }
    },
  }
}
