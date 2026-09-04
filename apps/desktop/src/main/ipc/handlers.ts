import { is } from '@electron-toolkit/utils'
import type {
  BlobStore,
  Card,
  Forecast,
  ImportanceLevel,
  JsonValue,
  RescheduleImpact,
  RescheduleSelection,
  SecretName,
  SecretStore,
  SessionEntry,
  SessionPlan,
  SessionRunnerState,
  SessionSummary,
  SettingsKey,
  SettingsRepository,
  UrgentModeHours,
} from '@retenia/core'
import { SETTINGS } from '@retenia/core'
import type { Contract } from '@retenia/ipc-contract'
import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import type { BackupService } from '../backups/service'
import { ensureDevMediaSample } from '../dev/media-sample'
import { collectSystemInfo, exportDiagnostics } from '../diagnostics/export'
import type { JobsFacade } from '../jobs/facade'
import type { MemoryService } from '../memory/service'
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
  memory: MemoryService | null
  /** Computed once at startup (`../backups/synced-folder.ts`). */
  syncedFolderWarning: boolean
  /** Closes the shared database, swaps in the chosen backup file, and relaunches the app.
   *  Never returns under normal operation — the process exits. */
  restoreFromBackup: () => Promise<boolean>
  dbUnavailableReason: string
  /** Broadcasts `settings.changed`; what makes `useSetting` a "subscription" in practice. */
  emitSettingsChanged: (key: string, value: JsonValue) => void
}

/** The bridge speaks ISO strings; the use cases speak `Date`. */
function toSelection(input: {
  cardIds?: readonly string[]
  itemIds?: readonly string[]
  levels?: readonly string[]
  limit?: number
}): RescheduleSelection {
  return {
    ...(input.cardIds === undefined ? {} : { cardIds: input.cardIds }),
    ...(input.itemIds === undefined ? {} : { itemIds: input.itemIds }),
    ...(input.levels === undefined ? {} : { levels: input.levels as ImportanceLevel[] }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  }
}

function toImpactDto(impact: RescheduleImpact) {
  return {
    ...impact,
    changes: impact.changes.map((change) => ({
      ...change,
      currentDue: change.currentDue.toISOString(),
      newDue: change.newDue.toISOString(),
    })),
    computedAt: impact.computedAt.toISOString(),
  }
}

function toPlanDto(plan: SessionPlan) {
  return {
    counts: plan.counts,
    overload: { ...plan.overload, byLevel: [...plan.overload.byLevel] },
    postponements: plan.postponements.length,
    burials: plan.burials.length,
    estimatedMinutes: plan.estimatedMinutes,
    budgetMinutes: plan.budgetMinutes,
    streakGoalCards: plan.streakGoalCards,
    medianSecondsPerCard: plan.medianSecondsPerCard,
    backlogDays: plan.backlogDays,
    newGated: plan.newGated,
    finalDrill: plan.finalDrill,
    order: plan.order,
    seed: plan.seed,
    composedAt: plan.composedAt.toISOString(),
  }
}

/** The FSRS half of the card only: `payload` is the activity's, and the audit columns are
 *  no business of the renderer. */
function toCardDto(card: Card) {
  return {
    id: card.id,
    itemId: card.itemId,
    template: card.template,
    payload: card.payload as JsonValue,
    state: card.state,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduledDays,
    learningSteps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.lastReview === null ? null : card.lastReview.toISOString(),
  }
}

function toEntryDto(entry: SessionEntry | null) {
  if (entry === null) return null
  if (entry.kind === 'reinforcement') return { kind: entry.kind, node: entry.node }
  return {
    kind: entry.kind,
    card: toCardDto(entry.card),
    level: entry.level,
    retrievability: entry.retrievability,
    desiredRetention: entry.options.desiredRetention,
    examId: entry.examId,
  }
}

function toProgressDto(state: SessionRunnerState) {
  return { ...state }
}

function toSummaryDto(summary: SessionSummary) {
  return {
    ...summary,
    overload: { ...summary.overload, byLevel: [...summary.overload.byLevel] },
    finishedAt: summary.finishedAt.toISOString(),
  }
}

function toForecastDto(forecast: Forecast) {
  return {
    ...forecast,
    days: forecast.days.map((day) => ({ ...day, byLevel: { ...day.byLevel } })),
    generatedAt: forecast.generatedAt.toISOString(),
  }
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
  memory,
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

    // --- memory: importance, urgent mode, reschedule (docs/spec/02-memory-system.md §7) ---

    'items.setImportance': async ({ ids, level }) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      return { updated: await memory.setItemImportance(ids, level as ImportanceLevel) }
    },

    'cards.overrideImportance': async ({ ids, level, expiresAt }) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      const updated = await memory.overrideCardImportance(
        ids,
        level as ImportanceLevel | null,
        expiresAt === undefined || expiresAt === null ? null : new Date(expiresAt),
      )
      return { updated }
    },

    'memory.importanceMix': async () => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      const mix = await memory.importanceMix()
      return { ...mix, entries: [...mix.entries], computedAt: mix.computedAt.toISOString() }
    },

    'memory.simulateReschedule': async (selection) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      return toImpactDto(await memory.simulateReschedule(toSelection(selection)))
    },

    'memory.rescheduleNow': async ({ confirm: _confirm, ...selection }) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      const { impact, applied } = await memory.rescheduleNow(toSelection(selection))
      return { impact: toImpactDto(impact), applied }
    },

    'memory.forecast': async ({ days }) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      return toForecastDto(await memory.forecast(days))
    },

    'session.plan': async (settings) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      return toPlanDto(await memory.planSession(settings))
    },

    'session.start': async ({ confirm: _confirm, ...settings }) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      const result = await memory.startSession(settings)
      return {
        progress: toProgressDto(result.runner.state()),
        resumed: result.resumed,
        burials: result.burials,
        postponed: result.postponed,
        // A resumed session shows the figures it was started with, not a fresh projection
        // of a day the user is halfway through.
        plan: result.plan === null ? null : toPlanDto(result.plan),
      }
    },

    'session.next': async () => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      const { entry, progress } = memory.sessionNext()
      return { entry: toEntryDto(entry), progress: toProgressDto(progress) }
    },

    'session.answer': async ({ rating, exerciseScore, durationMs, attemptId }) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      const { result, progress } = await memory.sessionAnswer({
        rating,
        ...(exerciseScore === undefined ? {} : { exerciseScore }),
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(attemptId === undefined ? {} : { attemptId }),
      })
      return {
        card: toCardDto(result.card),
        drilled: result.drilled,
        progress: toProgressDto(progress),
      }
    },

    'session.skip': async () => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      return { progress: toProgressDto(await memory.sessionSkip()) }
    },

    'session.undo': async () => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      const { undone, progress } = await memory.sessionUndo()
      return {
        undone: undone !== null,
        cardId: undone?.cardId ?? null,
        progress: toProgressDto(progress),
      }
    },

    'session.finish': async () => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      return toSummaryDto(await memory.sessionFinish())
    },

    'memory.startUrgentMode': async ({ itemIds, hours }) => {
      if (!memory) unavailable('memory', dbUnavailableReason)
      const result = await memory.startUrgentMode(itemIds, hours as UrgentModeHours | undefined)
      return { ...result, expiresAt: result.expiresAt.toISOString() }
    },

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
