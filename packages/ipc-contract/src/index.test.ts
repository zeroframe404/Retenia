import { describe, expect, expectTypeOf, it } from 'vitest'
import type { AssertNoEventsDomain, InferInput, InferOutput } from './index'
import {
  channelNames,
  contract,
  defineContract,
  eventNames,
  events,
  ipcFail,
  ipcOk,
  isChannelName,
  isEventName,
} from './index'

describe('contract', () => {
  it('names every channel domain.action', () => {
    for (const name of channelNames) {
      expect(name).toMatch(/^[a-z][a-z0-9]*\.[a-z][A-Za-z0-9]*$/)
    }
  })

  it('declares the channels the app implements', () => {
    expect([...channelNames].sort()).toEqual([
      'ai.cancelBatch',
      'ai.exportUsageCsv',
      'ai.getPricingOverlay',
      'ai.getRoles',
      'ai.getUsageSummary',
      'ai.listBatches',
      'ai.listProviderCards',
      'ai.listRecentCalls',
      'ai.probeProvider',
      'ai.restorePricing',
      'ai.setPricingOverlay',
      'ai.setRoles',
      'app.checkForUpdates',
      'app.devMediaSampleUrl',
      'app.exportDiagnostics',
      'app.getSettings',
      'app.getVersion',
      'app.ping',
      'app.quitAndInstall',
      'app.reportRendererError',
      'app.setDensity',
      'app.setGamificationProfile',
      'app.setTelemetryEnabled',
      'app.setTheme',
      'app.setUpdateChannel',
      'backups.backupNow',
      'backups.exportCopy',
      'backups.restoreFromBackup',
      'backups.status',
      'cards.disperseSiblings',
      'cards.overrideImportance',
      'cards.setLeech',
      'items.setImportance',
      'jobs.cancel',
      'jobs.enqueueDemo',
      'jobs.list',
      'jobs.retry',
      'library.addCourseFromFolder',
      'library.addSourceFromDialog',
      'library.addSourceFromFiles',
      'library.addSourceFromText',
      'library.addSourceFromUrl',
      'library.createAnnotation',
      'library.createCardFromAnnotation',
      'library.createCardFromChunk',
      'library.createCardFromClip',
      'library.deleteAnnotation',
      'library.deleteSource',
      'library.embedSource',
      'library.estimateContextualization',
      'library.getSource',
      'library.getSourceDoc',
      'library.listAnnotations',
      'library.listChunks',
      'library.listRecentlyOpened',
      'library.listSources',
      'library.listUnits',
      'library.recordProgress',
      'library.retrievalStatus',
      'library.retrySource',
      'library.search',
      'library.updateAnnotation',
      'memory.forecast',
      'memory.importanceMix',
      'memory.rescheduleNow',
      'memory.seedReviewDemo',
      'memory.simulateReschedule',
      'memory.startUrgentMode',
      'pathgen.buildItemBank',
      'pathgen.cancel',
      'pathgen.diagnosticAnswer',
      'pathgen.diagnosticFinish',
      'pathgen.diagnosticGet',
      'pathgen.diagnosticRevert',
      'pathgen.diagnosticStart',
      'pathgen.editDraft',
      'pathgen.expand',
      'pathgen.freeze',
      'pathgen.getItemBank',
      'pathgen.getLessons',
      'pathgen.getQaReport',
      'pathgen.getRun',
      'pathgen.getVersion',
      'pathgen.quote',
      'pathgen.regenerateLesson',
      'pathgen.resume',
      'pathgen.start',
      'scheduler.applyOptimization',
      'scheduler.optimize',
      'scheduler.setLevel',
      'scheduler.status',
      'scheduler.updateProfile',
      'secrets.delete',
      'secrets.get',
      'secrets.set',
      'session.answer',
      'session.finish',
      'session.next',
      'session.plan',
      'session.skip',
      'session.start',
      'session.undo',
      'settings.get',
      'settings.set',
      'stats.overview',
      'stats.trueRetention',
    ])
    expect([...eventNames].sort()).toEqual([
      'ai.batchProgress',
      'ai.budgetAlert',
      'app.deepLink',
      'app.themeChanged',
      'app.updateStatus',
      'jobs.progress',
      'pathgen.lessonStatus',
      'pathgen.progress',
      'settings.changed',
    ])
  })

  it('never declares a domain called "events"', () => {
    // A domain named `events` would collide with `api.events.on`. If this ever stops
    // resolving to `never`, the type below fails to compile.
    expectTypeOf<AssertNoEventsDomain<typeof contract>>().toBeNever()
  })
})

describe('app.ping', () => {
  const { input, output } = contract['app.ping']

  it('accepts an ISO timestamp', () => {
    expect(input.parse({ sentAt: '2026-09-02T00:00:00.000Z' })).toEqual({
      sentAt: '2026-09-02T00:00:00.000Z',
    })
  })

  it.each([
    ['a non-ISO string', { sentAt: 'not-a-date' }],
    ['a missing field', {}],
    ['a wrong type', { sentAt: 42 }],
    ['a non-object', 'nope'],
  ])('rejects %s', (_label, payload) => {
    expect(input.safeParse(payload).success).toBe(false)
  })

  it('validates the response too', () => {
    expect(
      output.safeParse({ sentAt: '2026-09-02T00:00:00.000Z', receivedAt: 'later' }).success,
    ).toBe(false)
  })

  it('infers its payload types', () => {
    expectTypeOf<InferInput<typeof contract, 'app.ping'>>().toEqualTypeOf<{ sentAt: string }>()
    expectTypeOf<InferOutput<typeof contract, 'app.ping'>>().toEqualTypeOf<{
      sentAt: string
      receivedAt: string
    }>()
  })
})

describe('app.getVersion', () => {
  it('takes no input', () => {
    expect(contract['app.getVersion'].input.safeParse(undefined).success).toBe(true)
    expectTypeOf<InferInput<typeof contract, 'app.getVersion'>>().toEqualTypeOf<void>()
  })

  it('requires all four version strings', () => {
    const { output } = contract['app.getVersion']
    expect(output.safeParse({ app: '1', electron: '2', chrome: '3', node: '4' }).success).toBe(true)
    expect(output.safeParse({ app: '1', electron: '2', chrome: '3' }).success).toBe(false)
  })
})

describe('app.themeChanged', () => {
  it('accepts only the two themes', () => {
    expect(events['app.themeChanged'].safeParse({ theme: 'dark' }).success).toBe(true)
    expect(events['app.themeChanged'].safeParse({ theme: 'sepia' }).success).toBe(false)
  })
})

describe('app.deepLink', () => {
  const schema = events['app.deepLink']

  it.each([
    { kind: 'import', src: 'https://example.com/book.pdf' },
    { kind: 'review' },
    { kind: 'authCallback', params: { code: 'abc' } },
  ])('accepts a %o payload', (payload) => {
    expect(schema.safeParse(payload).success).toBe(true)
  })

  it.each([
    ['an unknown kind', { kind: 'nope' }],
    ['import missing its src', { kind: 'import' }],
    ['authCallback with non-string params', { kind: 'authCallback', params: { code: 1 } }],
  ])('rejects %s', (_label, payload) => {
    expect(schema.safeParse(payload).success).toBe(false)
  })
})

describe('app.devMediaSampleUrl', () => {
  it('takes no input and returns a nullable url', () => {
    const { input, output } = contract['app.devMediaSampleUrl']
    expect(input.safeParse(undefined).success).toBe(true)
    expect(output.safeParse({ url: 'media://blob/abc.ogg' }).success).toBe(true)
    expect(output.safeParse({ url: null }).success).toBe(true)
    expect(output.safeParse({}).success).toBe(false)
  })
})

describe('app.getSettings / app.setUpdateChannel / app.setTelemetryEnabled / app.setTheme', () => {
  it('shares the same settings output shape', () => {
    const settings = {
      updateChannel: 'beta',
      telemetryEnabled: true,
      theme: 'system',
      density: 'comfortable',
      gamification: { profile: 'arcade' },
    }
    expect(contract['app.getSettings'].output.safeParse(settings).success).toBe(true)
    expect(contract['app.setUpdateChannel'].output.safeParse(settings).success).toBe(true)
    expect(contract['app.setTelemetryEnabled'].output.safeParse(settings).success).toBe(true)
    expect(contract['app.setTheme'].output.safeParse(settings).success).toBe(true)
    expect(contract['app.setDensity'].output.safeParse(settings).success).toBe(true)
    expect(contract['app.setGamificationProfile'].output.safeParse(settings).success).toBe(true)
  })

  it('accepts no input for getSettings', () => {
    expect(contract['app.getSettings'].input.safeParse(undefined).success).toBe(true)
  })

  it('only accepts latest or beta', () => {
    const { input } = contract['app.setUpdateChannel']
    expect(input.safeParse({ channel: 'latest' }).success).toBe(true)
    expect(input.safeParse({ channel: 'beta' }).success).toBe(true)
    expect(input.safeParse({ channel: 'nightly' }).success).toBe(false)
  })

  it('only accepts a boolean for telemetry', () => {
    const { input } = contract['app.setTelemetryEnabled']
    expect(input.safeParse({ enabled: true }).success).toBe(true)
    expect(input.safeParse({ enabled: 'true' }).success).toBe(false)
  })

  it('only accepts light, dark or system for theme', () => {
    const { input } = contract['app.setTheme']
    expect(input.safeParse({ theme: 'light' }).success).toBe(true)
    expect(input.safeParse({ theme: 'dark' }).success).toBe(true)
    expect(input.safeParse({ theme: 'system' }).success).toBe(true)
    expect(input.safeParse({ theme: 'sepia' }).success).toBe(false)
  })

  it('only accepts compact or comfortable for density', () => {
    const { input } = contract['app.setDensity']
    expect(input.safeParse({ density: 'compact' }).success).toBe(true)
    expect(input.safeParse({ density: 'comfortable' }).success).toBe(true)
    expect(input.safeParse({ density: 'cozy' }).success).toBe(false)
  })

  it('only accepts arcade or sober for the gamification profile', () => {
    const { input } = contract['app.setGamificationProfile']
    expect(input.safeParse({ profile: 'arcade' }).success).toBe(true)
    expect(input.safeParse({ profile: 'sober' }).success).toBe(true)
    expect(input.safeParse({ profile: 'hardcore' }).success).toBe(false)
  })
})

describe('app.checkForUpdates / app.quitAndInstall', () => {
  it('take and return nothing', () => {
    for (const channel of ['app.checkForUpdates', 'app.quitAndInstall'] as const) {
      expect(contract[channel].input.safeParse(undefined).success).toBe(true)
      expect(contract[channel].output.safeParse(undefined).success).toBe(true)
    }
  })
})

describe('app.exportDiagnostics', () => {
  it('returns a nullable saved path', () => {
    const { output } = contract['app.exportDiagnostics']
    expect(output.safeParse({ savedTo: 'C:\\diagnostics.zip' }).success).toBe(true)
    expect(output.safeParse({ savedTo: null }).success).toBe(true)
    expect(output.safeParse({}).success).toBe(false)
  })
})

describe('app.reportRendererError', () => {
  it('requires a name and message; the stack is optional', () => {
    const { input, output } = contract['app.reportRendererError']
    expect(input.safeParse({ name: 'TypeError', message: 'boom' }).success).toBe(true)
    expect(
      input.safeParse({ name: 'TypeError', message: 'boom', stack: 'at x (y:1:1)' }).success,
    ).toBe(true)
    expect(input.safeParse({ message: 'boom' }).success).toBe(false)
    expect(output.safeParse(undefined).success).toBe(true)
  })
})

describe('app.updateStatus', () => {
  const schema = events['app.updateStatus']

  it.each([
    { status: 'checking' },
    { status: 'not-available' },
    { status: 'available', version: '0.4.0' },
    { status: 'downloading', percent: 42 },
    { status: 'downloaded', version: '0.4.0' },
    { status: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' },
  ])('accepts a %o payload', (payload) => {
    expect(schema.safeParse(payload).success).toBe(true)
  })

  it.each([
    ['an unknown status', { status: 'nope' }],
    ['available missing its version', { status: 'available' }],
    ['downloading with an out-of-range percent', { status: 'downloading', percent: 101 }],
  ])('rejects %s', (_label, payload) => {
    expect(schema.safeParse(payload).success).toBe(false)
  })
})

describe('isChannelName / isEventName', () => {
  it('accepts declared names', () => {
    expect(isChannelName('app.ping')).toBe(true)
    expect(isEventName('app.themeChanged')).toBe(true)
  })

  it.each(['app.notDeclared', 'cards.review', '', 'toString', '__proto__', 'constructor'])(
    'rejects %j',
    (name) => {
      expect(isChannelName(name)).toBe(false)
      expect(isEventName(name)).toBe(false)
    },
  )

  it('rejects non-strings', () => {
    expect(isChannelName(undefined)).toBe(false)
    expect(isChannelName({ 'app.ping': true })).toBe(false)
  })
})

describe('envelope', () => {
  it('wraps success and failure', () => {
    expect(ipcOk({ a: 1 })).toEqual({ ok: true, data: { a: 1 } })
    expect(ipcFail('INVALID_INPUT', 'bad')).toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'bad' },
    })
  })
})

describe('defineContract', () => {
  it('keeps channel names literal', () => {
    const declared = defineContract({ 'demo.action': contract['app.ping'] })
    expectTypeOf<keyof typeof declared>().toEqualTypeOf<'demo.action'>()
  })
})
