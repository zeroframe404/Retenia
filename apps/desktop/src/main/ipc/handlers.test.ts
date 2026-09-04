import { SETTINGS_DEFAULTS } from '@retenia/core'
import { contract } from '@retenia/ipc-contract'
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

const ensureDevMediaSample = vi.fn(async () => 'media://blob/sample.ogg')
vi.mock('../dev/media-sample', () => ({ ensureDevMediaSample }))

const collectSystemInfo = vi.fn(async () => ({ appVersion: '0.1.0' }))
const exportDiagnostics = vi.fn(async () => {})
vi.mock('../diagnostics/export', () => ({ collectSystemInfo, exportDiagnostics }))

vi.mock('../paths', () => ({
  getDevMediaSamplePath: () => '/resources/dev/sample.ogg',
  getLogsDir: () => '/userData/logs',
}))

const { createHandlers } = await import('./handlers')

/** A stand-in job row, so the jobs fake returns something schema-shaped. */
const jobSummary = {
  id: '019213cd-0000-7000-8000-000000000001',
  kind: 'hashFile',
  status: 'queued' as const,
  priority: 0,
  progress: null,
  progressMessage: null,
  attempts: 0,
  maxAttempts: 3,
  error: null,
  subjectId: null,
  result: null,
  runAfter: '2026-09-02T00:00:00.000Z',
  createdAt: '2026-09-02T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
}

function makeSettingsRepo(): HandlerDeps['settingsRepo'] {
  const store = new Map<string, unknown>()
  return {
    get: vi.fn(async (key: keyof typeof SETTINGS_DEFAULTS) =>
      store.has(key) ? store.get(key) : SETTINGS_DEFAULTS[key],
    ),
    getStored: vi.fn(async () => ({})),
    getRaw: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    setRaw: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    all: vi.fn(async () => Object.fromEntries(store)),
    unset: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  } as unknown as HandlerDeps['settingsRepo']
}

/** Every method a spy, so a test can assert what the handler forwarded. */
const SESSION_ID = '019213cd-0000-7000-8000-0000000000ff'
const LOG_ID = '019213cd-0000-7000-8000-0000000000ee'
const CARD_ID = '019213cd-0000-7000-8000-0000000000cc'

const overload = {
  plannedCards: 3,
  keptCards: 1,
  postponedCards: 2,
  completedShare: 1 / 3,
  byLevel: [{ level: 'maintenance' as const, count: 2 }],
  budgetMinutes: 20,
  estimatedMinutes: 0.13,
  overloaded: true,
  stillOverBudget: false,
}

const plan = {
  entries: [],
  counts: {
    exam: 0,
    due: 1,
    relearning: 0,
    new: 0,
    reinforcement: 0,
    total: 1,
    byLevel: { urgent: 0, high: 0, normal: 1, maintenance: 0, paused: 0 },
  },
  postponements: [{}, {}],
  burials: [{}],
  overload,
  estimatedMinutes: 0.13,
  budgetMinutes: 20,
  streakGoalCards: 10,
  medianSecondsPerCard: 8,
  backlogDays: 0.1,
  newGated: false,
  finalDrill: false,
  order: 'relative_overdueness' as const,
  seed: '20605',
  composedAt: new Date('2026-09-02T00:00:00.000Z'),
}

const card = {
  id: CARD_ID,
  itemId: '019213cd-0000-7000-8000-0000000000aa',
  template: 'basic',
  payload: null,
  state: 2 as const,
  due: new Date('2026-09-03T00:00:00.000Z'),
  stability: 12.3,
  difficulty: 5.2,
  scheduledDays: 10,
  learningSteps: 0,
  reps: 6,
  lapses: 1,
  lastReview: new Date('2026-09-01T00:00:00.000Z'),
  // Audit columns the DTO must drop.
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  deletedAt: null,
  deviceId: 'test-device',
  version: 3,
  suspended: false,
  buriedUntil: null,
  leech: false,
  importanceOverride: null,
  importanceOverrideExpiresAt: null,
  examId: null,
}

const entry = {
  kind: 'due' as const,
  card,
  level: 'normal' as const,
  options: { desiredRetention: 0.9 },
  retrievability: 0.82,
  relativeOverdueness: 1.2,
  examId: null,
}

const item = { id: card.itemId, fields: { front: 'Capital of France?', back: 'Paris' } }

function previewResult(scheduledDays: number, stability: number, difficulty: number) {
  return {
    card: {
      ...card,
      due: new Date('2026-09-04T00:00:00.000Z'),
      scheduledDays,
      stability,
      difficulty,
    },
    log: {},
  }
}

const preview = {
  1: previewResult(0, 0.3, 6.2),
  2: previewResult(1, 1.1, 6),
  3: previewResult(4, 4.2, 5.5),
  4: previewResult(10, 9.8, 5),
}

const progress = {
  sessionId: SESSION_ID,
  cursor: 1,
  total: 3,
  remaining: 2,
  reviewed: 1,
  again: 0,
  hard: 0,
  skipped: 0,
  drillPending: 0,
  drillStarted: false,
  finished: false,
}

const summary = {
  sessionId: SESSION_ID,
  reviewed: 3,
  again: 1,
  hard: 0,
  skipped: 0,
  accuracy: 2 / 3,
  minutes: 1.5,
  xp: 0,
  postponed: 2,
  streak: {
    state: 'unknown' as const,
    current: 0,
    goalCards: 10,
    reviewedToday: 3,
    goalMet: false,
  },
  overload,
  finishedAt: new Date('2026-09-02T00:10:00.000Z'),
}

const forecast = {
  days: [
    {
      day: '2026-09-02',
      offset: 0,
      byLevel: { urgent: 0, high: 0, normal: 2, maintenance: 0, paused: 0 },
      cards: 2,
      minutes: 0.27,
      newCards: 5,
      cardsWithNew: 7,
      minutesWithNew: 0.93,
    },
  ],
  medianSecondsPerCard: 8,
  backlog: 1,
  newPool: 20,
  dailyNewLimit: 15,
  generatedAt: new Date('2026-09-02T00:00:00.000Z'),
}

function makeMemory(): HandlerDeps['memory'] {
  const impact = {
    affected: 0,
    skipped: { notInReview: 0, noMemoryState: 0, unchanged: 0 },
    dueInSevenDays: { before: 0, after: 0, delta: 0 },
    reviewsPerDay: { before: 0, after: 0, delta: 0 },
    byLevel: {
      urgent: { affected: 0, dueInSevenDaysDelta: 0 },
      high: { affected: 0, dueInSevenDaysDelta: 0 },
      normal: { affected: 0, dueInSevenDaysDelta: 0 },
      maintenance: { affected: 0, dueInSevenDaysDelta: 0 },
      paused: { affected: 0, dueInSevenDaysDelta: 0 },
    },
    changes: [],
    computedAt: new Date('2026-09-02T00:00:00.000Z'),
  }
  return {
    setItemImportance: vi.fn(async (ids: readonly string[]) => ids.length),
    overrideCardImportance: vi.fn(async (ids: readonly string[]) => ids.length),
    setCardLeech: vi.fn(async (ids: readonly string[]) => ids.length),
    importanceMix: vi.fn(async () => ({
      entries: [],
      totalItems: 0,
      totalCards: 0,
      prioritizedShare: 0,
      threshold: 0.3,
      biasWarning: false,
      computedAt: new Date('2026-09-02T00:00:00.000Z'),
    })),
    simulateReschedule: vi.fn(async () => impact),
    rescheduleNow: vi.fn(async () => ({ impact, applied: 0 })),
    startUrgentMode: vi.fn(async (itemIds: readonly string[]) => ({
      items: itemIds.length,
      cards: itemIds.length,
      expiresAt: new Date('2026-09-04T00:00:00.000Z'),
      truncated: false,
    })),
    expireUrgentMode: vi.fn(async () => 0),
    resolve: vi.fn(),
    refresh: vi.fn(async () => {}),

    planSession: vi.fn(async () => plan),
    startSession: vi.fn(async () => ({
      runner: { state: () => progress },
      session: { id: SESSION_ID },
      plan,
      entries: [],
      resumed: false,
      burials: 1,
      postponed: 2,
    })),
    sessionNext: vi.fn(async () => ({ entry, progress, item, preview })),
    sessionAnswer: vi.fn(async () => ({
      result: { card, logId: LOG_ID, rating: 3 as const, drilled: false, remaining: 0 },
      progress,
    })),
    sessionSkip: vi.fn(async () => progress),
    sessionUndo: vi.fn(async () => ({
      undone: { card, logId: LOG_ID, cardId: card.id },
      progress,
    })),
    sessionFinish: vi.fn(async () => summary),
    forecast: vi.fn(async () => forecast),
    seedReviewDemo: vi.fn(async (count: number) => ({
      itemIds: Array.from({ length: count }, () => item.id),
      cardIds: Array.from({ length: count }, () => card.id),
    })),
  } as unknown as HandlerDeps['memory']
}

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    settings: {
      get: vi.fn(() => ({
        updateChannel: 'latest' as const,
        telemetryEnabled: false,
        theme: 'system' as const,
        density: 'comfortable' as const,
        gamification: { profile: 'arcade' as const },
      })),
      setUpdateChannel: vi.fn((channel: 'latest' | 'beta') => ({
        updateChannel: channel,
        telemetryEnabled: false,
        theme: 'system' as const,
        density: 'comfortable' as const,
        gamification: { profile: 'arcade' as const },
      })),
      setTelemetryEnabled: vi.fn((enabled: boolean) => ({
        updateChannel: 'latest' as const,
        telemetryEnabled: enabled,
        theme: 'system' as const,
        density: 'comfortable' as const,
        gamification: { profile: 'arcade' as const },
      })),
      setTheme: vi.fn((theme: 'light' | 'dark' | 'system') => ({
        updateChannel: 'latest' as const,
        telemetryEnabled: false,
        theme,
        density: 'comfortable' as const,
        gamification: { profile: 'arcade' as const },
      })),
      setDensity: vi.fn((density: 'compact' | 'comfortable') => ({
        updateChannel: 'latest' as const,
        telemetryEnabled: false,
        theme: 'system' as const,
        density,
        gamification: { profile: 'arcade' as const },
      })),
      setGamificationProfile: vi.fn((profile: 'arcade' | 'sober') => ({
        updateChannel: 'latest' as const,
        telemetryEnabled: false,
        theme: 'system' as const,
        density: 'comfortable' as const,
        gamification: { profile },
      })),
    } as unknown as HandlerDeps['settings'],
    jobs: {
      list: vi.fn(async () => []),
      cancel: vi.fn(async (id: string) => ({ ...jobSummary, id, status: 'cancelled' as const })),
      retry: vi.fn(async (id: string) => ({ ...jobSummary, id, status: 'queued' as const })),
      enqueueDemo: vi.fn(async () => ({ job: jobSummary, subject: '/resources/dev/sample.ogg' })),
    },
    blobStore: {
      put: vi.fn(),
      has: vi.fn(),
      path: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    } as unknown as HandlerDeps['blobStore'],
    updater: {
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn(),
      stop: vi.fn(),
    },
    reportRendererError: vi.fn(),
    secrets: {
      setSecret: vi.fn(async () => {}),
      getSecret: vi.fn(async () => undefined),
      deleteSecret: vi.fn(async () => {}),
      hasSecret: vi.fn(async () => false),
    },
    backups: {
      backupNow: vi.fn(async () => '/userData/backups/retenia-20260101-0000.db'),
      list: vi.fn(async () => []),
      exportCopy: vi.fn(async () => {}),
      runIntegrityCheck: vi.fn(() => 'ok' as const),
    },
    settingsRepo: makeSettingsRepo(),
    memory: makeMemory(),
    syncedFolderWarning: false,
    restoreFromBackup: vi.fn(async () => true),
    dbUnavailableReason: 'the database did not open',
    emitSettingsChanged: vi.fn(),
    reviewDemoEnabled: true,
    ...overrides,
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
      density: 'comfortable',
      gamification: { profile: 'arcade' },
    })
    expect(handlers['app.setTelemetryEnabled']({ enabled: true }, fakeEvent)).toEqual({
      updateChannel: 'latest',
      telemetryEnabled: true,
      theme: 'system',
      density: 'comfortable',
      gamification: { profile: 'arcade' },
    })
  })

  it('sets nativeTheme.themeSource and persists the preference', () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)

    expect(handlers['app.setTheme']({ theme: 'dark' }, fakeEvent)).toEqual({
      updateChannel: 'latest',
      telemetryEnabled: false,
      theme: 'dark',
      density: 'comfortable',
      gamification: { profile: 'arcade' },
    })
    expect(nativeTheme.themeSource).toBe('dark')
    expect(deps.settings.setTheme).toHaveBeenCalledWith('dark')
  })
})

describe('app.setDensity / app.setGamificationProfile', () => {
  it('delegates straight to the settings store', () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)

    expect(handlers['app.setDensity']({ density: 'compact' }, fakeEvent)).toEqual({
      updateChannel: 'latest',
      telemetryEnabled: false,
      theme: 'system',
      density: 'compact',
      gamification: { profile: 'arcade' },
    })
    expect(deps.settings.setDensity).toHaveBeenCalledWith('compact')

    expect(handlers['app.setGamificationProfile']({ profile: 'sober' }, fakeEvent)).toEqual({
      updateChannel: 'latest',
      telemetryEnabled: false,
      theme: 'system',
      density: 'comfortable',
      gamification: { profile: 'sober' },
    })
    expect(deps.settings.setGamificationProfile).toHaveBeenCalledWith('sober')
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
  it('returns null outside dev', async () => {
    devMode = false
    const handlers = createHandlers(makeDeps())
    expect(await handlers['app.devMediaSampleUrl'](undefined, fakeEvent)).toEqual({ url: null })
    expect(ensureDevMediaSample).not.toHaveBeenCalled()
  })

  it('puts the sample into the blob store in dev', async () => {
    devMode = true
    const deps = makeDeps()
    const handlers = createHandlers(deps)
    expect(await handlers['app.devMediaSampleUrl'](undefined, fakeEvent)).toEqual({
      url: 'media://blob/sample.ogg',
    })
    expect(ensureDevMediaSample).toHaveBeenCalledWith('/resources/dev/sample.ogg', deps.blobStore)
  })
})

describe('jobs channels', () => {
  it('lists jobs, passing the filter straight through', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)
    const result = await handlers['jobs.list']({ statuses: ['running'], limit: 10 }, fakeEvent)

    expect(result).toEqual({ jobs: [] })
    expect(deps.jobs.list).toHaveBeenCalledExactlyOnceWith({
      statuses: ['running'],
      limit: 10,
    })
  })

  it('cancels and retries by id', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)

    expect(await handlers['jobs.cancel']({ id: jobSummary.id }, fakeEvent)).toMatchObject({
      status: 'cancelled',
    })
    expect(deps.jobs.cancel).toHaveBeenCalledExactlyOnceWith(jobSummary.id)

    expect(await handlers['jobs.retry']({ id: jobSummary.id }, fakeEvent)).toMatchObject({
      status: 'queued',
    })
    expect(deps.jobs.retry).toHaveBeenCalledExactlyOnceWith(jobSummary.id)
  })

  it('queues a demo job', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)
    const result = await handlers['jobs.enqueueDemo']({ kind: 'sleep', ms: 100 }, fakeEvent)

    expect(result.job).toMatchObject({ kind: 'hashFile' })
    expect(deps.jobs.enqueueDemo).toHaveBeenCalledExactlyOnceWith({ kind: 'sleep', ms: 100 })
  })
})

describe('secrets channels', () => {
  it('sets, reads back a masked preview of, and deletes a secret', async () => {
    const deps = makeDeps()
    // A minimal fake that actually remembers the value, so `get` can prove the preview is
    // derived from it rather than hard-coded.
    let stored: string | undefined
    deps.secrets = {
      setSecret: vi.fn(async (_name, value: string) => {
        stored = value
      }),
      getSecret: vi.fn(async () => stored),
      deleteSecret: vi.fn(async () => {
        stored = undefined
      }),
      hasSecret: vi.fn(async () => stored !== undefined),
    }
    const handlers = createHandlers(deps)

    expect(
      await handlers['secrets.set']({ name: 'anthropic', value: 'sk-ant-abcdwxyz' }, fakeEvent),
    ).toEqual({ ok: true })

    expect(await handlers['secrets.get']({ name: 'anthropic' }, fakeEvent)).toEqual({
      hasSecret: true,
      preview: '••••wxyz',
    })

    expect(await handlers['secrets.delete']({ name: 'anthropic' }, fakeEvent)).toEqual({
      ok: true,
    })
    expect(await handlers['secrets.get']({ name: 'anthropic' }, fakeEvent)).toEqual({
      hasSecret: false,
      preview: null,
    })
  })

  it('fails every secrets channel when the database never opened', async () => {
    const deps = makeDeps({ secrets: null })
    const handlers = createHandlers(deps)

    await expect(
      handlers['secrets.set']({ name: 'anthropic', value: 'x' }, fakeEvent),
    ).rejects.toThrow(/unavailable/)
    await expect(handlers['secrets.get']({ name: 'anthropic' }, fakeEvent)).rejects.toThrow(
      /unavailable/,
    )
    await expect(handlers['secrets.delete']({ name: 'anthropic' }, fakeEvent)).rejects.toThrow(
      /unavailable/,
    )
  })
})

describe('backups channels', () => {
  it('reports status, backs up now, and exports a copy', async () => {
    const deps = makeDeps()
    fromWebContents.mockReturnValue(null)
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/retenia-export.zip' })
    const handlers = createHandlers(deps)

    expect(await handlers['backups.status'](undefined, fakeEvent)).toEqual({
      backups: [],
      syncedFolderWarning: false,
    })

    expect(await handlers['backups.backupNow'](undefined, fakeEvent)).toEqual({
      file: '/userData/backups/retenia-20260101-0000.db',
    })

    const result = await handlers['backups.exportCopy'](undefined, fakeEvent)
    expect(result).toEqual({ savedTo: '/tmp/retenia-export.zip' })
    expect(deps.backups?.exportCopy).toHaveBeenCalledWith('/tmp/retenia-export.zip')
  })

  it('restoreFromBackup delegates to the injected relaunch flow', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)

    expect(await handlers['backups.restoreFromBackup'](undefined, fakeEvent)).toEqual({
      restored: true,
    })
    expect(deps.restoreFromBackup).toHaveBeenCalledOnce()
  })

  it('fails every backups channel when the database never opened', async () => {
    const deps = makeDeps({ backups: null })
    const handlers = createHandlers(deps)

    await expect(handlers['backups.status'](undefined, fakeEvent)).rejects.toThrow(/unavailable/)
    await expect(handlers['backups.backupNow'](undefined, fakeEvent)).rejects.toThrow(/unavailable/)
  })
})

describe('settings channels', () => {
  it('round-trips a registered key and broadcasts the change', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)

    expect(await handlers['settings.get']({ key: 'ui.theme' }, fakeEvent)).toEqual({
      value: 'system',
    })

    expect(await handlers['settings.set']({ key: 'ui.soberMode', value: true }, fakeEvent)).toEqual(
      { value: true },
    )
    expect(deps.emitSettingsChanged).toHaveBeenCalledWith('ui.soberMode', true)

    expect(await handlers['settings.get']({ key: 'ui.soberMode' }, fakeEvent)).toEqual({
      value: true,
    })
  })

  it('rejects a key outside the registry rather than crashing', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)

    await expect(handlers['settings.get']({ key: 'not.a.real.key' }, fakeEvent)).rejects.toThrow(
      /not a registered setting/,
    )
    await expect(
      handlers['settings.set']({ key: 'not.a.real.key', value: 1 }, fakeEvent),
    ).rejects.toThrow(/not a registered setting/)
  })

  it('fails when the database never opened', async () => {
    const deps = makeDeps({ settingsRepo: null })
    const handlers = createHandlers(deps)

    await expect(handlers['settings.get']({ key: 'ui.theme' }, fakeEvent)).rejects.toThrow(
      /unavailable/,
    )
  })
})

describe('memory channels', () => {
  const ID = '019213cd-0000-7000-8000-000000000001'

  it('forwards an item importance change and reports how many rows moved', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)

    expect(
      await handlers['items.setImportance']({ ids: [ID], level: 'urgent' }, fakeEvent),
    ).toEqual({ updated: 1 })
    expect(deps.memory?.setItemImportance).toHaveBeenCalledExactlyOnceWith([ID], 'urgent')
  })

  it('turns the override’s ISO expiry back into a Date for the use case', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)

    await handlers['cards.overrideImportance'](
      { ids: [ID], level: 'urgent', expiresAt: '2026-09-04T00:00:00.000Z' },
      fakeEvent,
    )
    expect(deps.memory?.overrideCardImportance).toHaveBeenCalledExactlyOnceWith(
      [ID],
      'urgent',
      new Date('2026-09-04T00:00:00.000Z'),
    )
  })

  it('treats a missing or null expiry as "permanent"', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)

    await handlers['cards.overrideImportance']({ ids: [ID], level: 'high' }, fakeEvent)
    await handlers['cards.overrideImportance'](
      { ids: [ID], level: null, expiresAt: null },
      fakeEvent,
    )
    expect(deps.memory?.overrideCardImportance).toHaveBeenNthCalledWith(1, [ID], 'high', null)
    expect(deps.memory?.overrideCardImportance).toHaveBeenNthCalledWith(2, [ID], null, null)
  })

  it('sends every Date across the bridge as an ISO string', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)

    const mix = await handlers['memory.importanceMix'](undefined, fakeEvent)
    expect(mix.computedAt).toBe('2026-09-02T00:00:00.000Z')

    const impact = await handlers['memory.simulateReschedule']({ limit: 2_000 }, fakeEvent)
    expect(impact.computedAt).toBe('2026-09-02T00:00:00.000Z')

    const urgent = await handlers['memory.startUrgentMode']({ itemIds: [ID], hours: 72 }, fakeEvent)
    expect(urgent.expiresAt).toBe('2026-09-04T00:00:00.000Z')
    expect(deps.memory?.startUrgentMode).toHaveBeenCalledExactlyOnceWith([ID], 72)
  })

  it('drops the confirmation flag before handing the selection to the use case', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)

    await handlers['memory.rescheduleNow'](
      { cardIds: [ID], limit: 2_000, confirm: true },
      fakeEvent,
    )
    expect(deps.memory?.rescheduleNow).toHaveBeenCalledExactlyOnceWith({
      cardIds: [ID],
      limit: 2_000,
    })
  })

  it('reports the failure rather than pretending, when the database did not open', async () => {
    const handlers = createHandlers(makeDeps({ memory: null }))
    const channels = [
      ['items.setImportance', { ids: [ID], level: 'normal' }],
      ['cards.overrideImportance', { ids: [ID], level: null }],
      ['cards.setLeech', { ids: [ID], leech: true }],
      ['memory.importanceMix', undefined],
      ['memory.simulateReschedule', { limit: 2_000 }],
      ['memory.rescheduleNow', { limit: 2_000, confirm: true }],
      ['memory.startUrgentMode', { itemIds: [ID] }],
      ['memory.forecast', { days: 30 }],
      ['session.plan', {}],
      ['session.start', { confirm: true }],
      ['session.next', undefined],
      ['session.answer', { rating: 3 }],
      ['session.skip', undefined],
      ['session.undo', undefined],
      ['session.finish', undefined],
      ['memory.seedReviewDemo', { count: 1 }],
    ] as const

    for (const [channel, input] of channels) {
      await expect(
        // biome-ignore lint/suspicious/noExplicitAny: one loop over heterogeneous channels.
        (handlers[channel] as any)(input, fakeEvent),
      ).rejects.toThrow('memory is unavailable')
    }
  })
})

describe('session channels', () => {
  it('summarises the plan: counts, not the 2,000 cards behind them', async () => {
    const handlers = createHandlers(makeDeps())
    const dto = await handlers['session.plan']({}, fakeEvent)

    expect(dto.counts).toEqual({
      exam: 0,
      due: 1,
      relearning: 0,
      new: 0,
      reinforcement: 0,
      total: 1,
      byLevel: { urgent: 0, high: 0, normal: 1, maintenance: 0, paused: 0 },
    })
    // The proposals cross the bridge as counts; `session.start` decides which cards.
    expect(dto.postponements).toBe(2)
    expect(dto.burials).toBe(1)
    expect(dto.composedAt).toBe('2026-09-02T00:00:00.000Z')
    expect(dto).not.toHaveProperty('entries')
  })

  it('drops the confirmation flag before handing the settings to the use case', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)

    const started = await handlers['session.start']({ confirm: true, budgetMinutes: 15 }, fakeEvent)
    expect(deps.memory?.startSession).toHaveBeenCalledExactlyOnceWith({ budgetMinutes: 15 })
    expect(started).toMatchObject({ resumed: false, burials: 1, postponed: 2 })
    expect(started.plan?.seed).toBe('20605')
  })

  it('sends the FSRS half of the card and nothing else', async () => {
    const handlers = createHandlers(makeDeps())
    const { entry: dto } = await handlers['session.next'](undefined, fakeEvent)

    expect(dto).toMatchObject({ kind: 'due', level: 'normal', retrievability: 0.82 })
    const sent = (dto as { card: Record<string, unknown> }).card
    expect(sent.due).toBe('2026-09-03T00:00:00.000Z')
    expect(sent.lastReview).toBe('2026-09-01T00:00:00.000Z')
    // Audit columns and the internal flags stay in main.
    for (const column of ['createdAt', 'updatedAt', 'deviceId', 'version', 'buriedUntil']) {
      expect(sent).not.toHaveProperty(column)
    }
    // The desired retention is lifted out of the resolved options for the interval preview.
    expect(dto).toMatchObject({ desiredRetention: 0.9 })
  })

  it('sends the item fields and the four-button interval preview alongside the card', async () => {
    const handlers = createHandlers(makeDeps())
    const { item: itemDto, preview: previewDto } = await handlers['session.next'](
      undefined,
      fakeEvent,
    )

    expect(itemDto).toEqual({ fields: { front: 'Capital of France?', back: 'Paris' } })
    expect(previewDto).toEqual([
      {
        grade: 1,
        due: '2026-09-04T00:00:00.000Z',
        scheduledDays: 0,
        stability: 0.3,
        difficulty: 6.2,
      },
      {
        grade: 2,
        due: '2026-09-04T00:00:00.000Z',
        scheduledDays: 1,
        stability: 1.1,
        difficulty: 6,
      },
      {
        grade: 3,
        due: '2026-09-04T00:00:00.000Z',
        scheduledDays: 4,
        stability: 4.2,
        difficulty: 5.5,
      },
      {
        grade: 4,
        due: '2026-09-04T00:00:00.000Z',
        scheduledDays: 10,
        stability: 9.8,
        difficulty: 5,
      },
    ])
  })

  it('marks a card as a leech', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)

    expect(await handlers['cards.setLeech']({ ids: [CARD_ID], leech: true }, fakeEvent)).toEqual({
      updated: 1,
    })
    expect(deps.memory?.setCardLeech).toHaveBeenCalledExactlyOnceWith([CARD_ID], true)
  })

  it('seeds review demo cards only when the demo gate is on', async () => {
    const enabledDeps = makeDeps({ reviewDemoEnabled: true })
    const enabled = createHandlers(enabledDeps)
    expect(await enabled['memory.seedReviewDemo']({ count: 3 }, fakeEvent)).toEqual({
      itemIds: [item.id, item.id, item.id],
      cardIds: [card.id, card.id, card.id],
    })

    const disabled = createHandlers(makeDeps({ reviewDemoEnabled: false }))
    expect(await disabled['memory.seedReviewDemo']({ count: 3 }, fakeEvent)).toEqual({
      itemIds: [],
      cardIds: [],
    })
  })

  it('forwards only the optional answer fields that were given', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)

    await handlers['session.answer']({ rating: 3 }, fakeEvent)
    expect(deps.memory?.sessionAnswer).toHaveBeenCalledExactlyOnceWith({ rating: 3 })

    await handlers['session.answer']({ rating: 1, exerciseScore: 0.4, durationMs: 900 }, fakeEvent)
    expect(deps.memory?.sessionAnswer).toHaveBeenLastCalledWith({
      rating: 1,
      exerciseScore: 0.4,
      durationMs: 900,
    })
  })

  it('reports undo as a boolean plus the card that came back', async () => {
    const handlers = createHandlers(makeDeps())
    expect(await handlers['session.undo'](undefined, fakeEvent)).toMatchObject({
      undone: true,
      cardId: CARD_ID,
    })
  })

  /**
   * `registerHandlers` validates every response against the contract before it leaves main,
   * so a DTO that drifted from its schema would fail at runtime rather than at compile time
   * — these handlers return plain objects, and TypeScript cannot see the zod shape. This is
   * the assertion that catches it.
   */
  it('returns what the contract declares, for every session channel', async () => {
    const handlers = createHandlers(makeDeps())
    const calls = [
      ['session.plan', {}],
      ['session.start', { confirm: true }],
      ['session.next', undefined],
      ['session.answer', { rating: 3 }],
      ['session.skip', undefined],
      ['session.undo', undefined],
      ['session.finish', undefined],
      ['memory.forecast', { days: 30 }],
    ] as const

    for (const [channel, input] of calls) {
      // biome-ignore lint/suspicious/noExplicitAny: one loop over heterogeneous channels.
      const output = await (handlers[channel] as any)(input, fakeEvent)
      expect(() => contract[channel].output.parse(output), channel).not.toThrow()
    }
  })

  it('sends every Date in the summary and the forecast as an ISO string', async () => {
    const handlers = createHandlers(makeDeps())

    const summaryDto = await handlers['session.finish'](undefined, fakeEvent)
    expect(summaryDto.finishedAt).toBe('2026-09-02T00:10:00.000Z')
    expect(summaryDto.accuracy).toBeCloseTo(2 / 3, 10)

    const forecastDto = await handlers['memory.forecast']({ days: 30 }, fakeEvent)
    expect(forecastDto.generatedAt).toBe('2026-09-02T00:00:00.000Z')
    expect(forecastDto.days[0]?.byLevel).toEqual({
      urgent: 0,
      high: 0,
      normal: 2,
      maintenance: 0,
      paused: 0,
    })
  })
})
