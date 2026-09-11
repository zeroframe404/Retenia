import type { ItemBankEntry } from '@retenia/core'
import type { BuildItemBankResult, ReconcileResult } from '@retenia/pathgen'
import { describe, expect, it, vi } from 'vitest'
import { createPathgenFacade, type PathgenFacadeDeps } from './facade'
import { createItemBankService } from './item-bank-service'

vi.mock('../logging/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

/** Stage 9's main-process wrapper (sub-phase 8.5): one build per version, status from rows. */

function entry(overrides: Partial<ItemBankEntry> = {}): ItemBankEntry {
  const at = new Date('2026-09-11T12:00:00.000Z')
  return {
    id: 'item-1',
    activityId: 'activity-1',
    pathVersionId: 'version-1',
    moduleId: 'module-1',
    usage: ['diagnostic'],
    difficultyLogit: 0,
    discriminationHint: null,
    exposure: 0,
    stats: { n: 0, p_correct: null },
    authoring: { cell_key: 'M01|diagnostic|core|understand' },
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    deviceId: 'test',
    version: 1,
    ...overrides,
  }
}

function result(overrides: Partial<BuildItemBankResult['cells']> = {}): BuildItemBankResult {
  return {
    pathVersionId: 'version-1',
    blueprint: {} as BuildItemBankResult['blueprint'],
    status: 'completed',
    examDeferred: false,
    cells: { total: 4, alreadyBuilt: 0, built: 4, short: 0, failed: 0, ...overrides },
    created: 4,
    byUsage: {
      diagnostic: 1,
      reinforcement: 0,
      final_exam_A: 0,
      final_exam_B: 0,
      remediation: 0,
      mock: 0,
    },
    warnings: [],
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, usd: 0 },
  }
}

const noReconcile = async (): Promise<ReconcileResult> => ({
  dropped: [],
  restricted: [],
  warnings: [],
})

describe('createItemBankService', () => {
  it('is empty before any build, and counts usages from the rows', async () => {
    const rows: ItemBankEntry[] = []
    const service = createItemBankService({
      repos: { itemBank: { listByPathVersion: async () => rows } },
      build: async () => result(),
      reconcile: noReconcile,
    })
    expect((await service.status('version-1')).state).toBe('empty')

    rows.push(entry(), entry({ id: 'item-2', usage: ['final_exam_A', 'mock'] }))
    const status = await service.status('version-1')
    expect(status.items).toBe(2)
    expect(status.diagnosticItems).toBe(1)
    expect(status.byUsage).toMatchObject({ diagnostic: 1, final_exam_A: 1, mock: 1 })
  })

  it('joins a running build instead of starting a second one', async () => {
    let release: () => void = () => {}
    const build = vi.fn(
      () =>
        new Promise<BuildItemBankResult>((resolve) => {
          release = () => resolve(result())
        }),
    )
    const rows: ItemBankEntry[] = []
    const service = createItemBankService({
      repos: { itemBank: { listByPathVersion: async () => rows } },
      build,
      reconcile: noReconcile,
    })

    expect((await service.build('version-1')).state).toBe('building')
    expect((await service.build('version-1')).state).toBe('building')
    expect(build).toHaveBeenCalledOnce()

    rows.push(entry())
    release()
    const done = await service.buildAndWait('version-1')
    expect(done.state).toBe('ready')
    expect(done.cells).toEqual({ total: 4, built: 4, short: 0, failed: 0 })
  })

  it('reports partial when a cell came short or failed', async () => {
    const service = createItemBankService({
      repos: { itemBank: { listByPathVersion: async () => [entry()] } },
      build: async () => result({ built: 3, short: 1 }),
      reconcile: noReconcile,
    })
    expect((await service.buildAndWait('version-1')).state).toBe('partial')
  })

  it('reports failed, with the error, when the build throws — and a retry clears it', async () => {
    const build = vi
      .fn<() => Promise<BuildItemBankResult>>()
      .mockRejectedValueOnce(new Error('no model for the smart role'))
      .mockResolvedValueOnce(result())
    const service = createItemBankService({
      repos: { itemBank: { listByPathVersion: async () => [entry()] } },
      build,
      reconcile: noReconcile,
    })

    const failed = await service.buildAndWait('version-1')
    expect(failed.state).toBe('failed')
    expect(failed.error).toBe('no model for the smart role')
    expect((await service.buildAndWait('version-1')).state).toBe('ready')
  })

  it('never lets a failed reconcile escape', async () => {
    const service = createItemBankService({
      repos: { itemBank: { listByPathVersion: async () => [] } },
      build: async () => result(),
      reconcile: async () => {
        throw new Error('embeddings down')
      },
    })
    await expect(
      service.reconcileLesson({
        pathVersionId: 'version-1',
        lessonId: 'lesson-1',
        lessonSpecId: 'L01',
      }),
    ).resolves.toBeUndefined()
  })
})

describe('createItemBankService — the exam cells after the last lesson', () => {
  const quietRows = { itemBank: { listByPathVersion: async () => [entry()] } }

  it('builds, without the over-budget pass, once examDue says the lessons have settled', async () => {
    const build = vi.fn(async () => result())
    const examDue = vi.fn(async () => true)
    const service = createItemBankService({
      repos: quietRows,
      build,
      reconcile: noReconcile,
      examDue,
    })

    await service.onLessonSettled('version-1')
    await vi.waitFor(() => expect(build).toHaveBeenCalledOnce())
    expect(build).toHaveBeenCalledWith({
      pathVersionId: 'version-1',
      allowOverBudget: false,
      userWaiting: true,
    })
  })

  it('does nothing while a lesson is still open, or when nothing is wired to ask', async () => {
    const build = vi.fn(async () => result())
    await createItemBankService({
      repos: quietRows,
      build,
      reconcile: noReconcile,
      examDue: async () => false,
    }).onLessonSettled('version-1')
    await createItemBankService({
      repos: quietRows,
      build,
      reconcile: noReconcile,
    }).onLessonSettled('version-1')
    expect(build).not.toHaveBeenCalled()
  })

  it('runs again after a build that started before the last lesson settled', async () => {
    let release: () => void = () => {}
    const build = vi
      .fn<() => Promise<BuildItemBankResult>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(result())
          }),
      )
      .mockResolvedValue(result())
    const service = createItemBankService({
      repos: quietRows,
      build,
      reconcile: noReconcile,
      examDue: async () => true,
    })

    await service.build('version-1')
    await service.onLessonSettled('version-1')
    expect(build).toHaveBeenCalledOnce()

    release()
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(2))
  })

  it('never lets a failing examDue escape', async () => {
    const service = createItemBankService({
      repos: quietRows,
      build: async () => result(),
      reconcile: noReconcile,
      examDue: async () => {
        throw new Error('database is closed')
      },
    })
    await expect(service.onLessonSettled('version-1')).resolves.toBeUndefined()
  })
})

describe('the facade’s 8.5 methods', () => {
  const base = {
    runs: {} as PathgenFacadeDeps['runs'],
    expansion: {} as PathgenFacadeDeps['expansion'],
    repos: {} as PathgenFacadeDeps['repos'],
    clock: { now: () => new Date() },
    quote: vi.fn(),
  }

  it('starts the build when the diagnostic screen finds an empty bank', async () => {
    const rows: ItemBankEntry[] = []
    const build = vi.fn(async () => {
      rows.push(entry())
      return result()
    })
    const itemBank = createItemBankService({
      repos: { itemBank: { listByPathVersion: async () => rows } },
      build,
      reconcile: noReconcile,
    })
    const diagnostics = {
      get: vi.fn(async () => ({ sections: [], state: null })),
    } as unknown as NonNullable<PathgenFacadeDeps['diagnostics']>
    const facade = createPathgenFacade({ ...base, itemBank, diagnostics })

    const opened = await facade.diagnosticGet({ pathVersionId: 'version-1' })

    expect(build).toHaveBeenCalledOnce()
    expect(opened.itemBank.state).toBe('building')
    expect(opened.state).toBeNull()
  })

  it('says so plainly when the item bank or the diagnostic is not wired', async () => {
    const facade = createPathgenFacade(base)
    await expect(facade.getItemBank({ pathVersionId: 'version-1' })).rejects.toThrow(
      /item bank is not available/,
    )
    await expect(facade.diagnosticFinish({ sessionId: 'session-1' })).rejects.toThrow(
      /diagnostic is not available/,
    )
  })
})
