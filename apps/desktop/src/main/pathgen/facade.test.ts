import type {
  GenerationRun,
  LearningPath,
  Lesson,
  Module,
  PathTree,
  PathVersion,
  Section,
} from '@retenia/core'
import type { PathDraft } from '@retenia/pathgen'
import { pathDraftSchema } from '@retenia/pathgen'
import { describe, expect, it, vi } from 'vitest'
import { createPathgenFacade, type PathgenFacadeRepos } from './facade'

/**
 * `PathgenFacade`'s own wiring — the frozen-version guard, the `deepenLesson` cost-rate
 * lookup, and the DTO round trip — not `applyEdit`/`freezePath`'s internal correctness,
 * which `packages/pathgen`'s own suite already covers against a full in-memory repo.
 */

const clock = { now: () => new Date('2026-09-09T12:00:00.000Z') }

function draft(overrides: Partial<PathDraft> = {}): PathDraft {
  return pathDraftSchema.parse({
    version: 1,
    kind: 'draft',
    title: 'Curso',
    language: 'es-AR',
    level: 'beginner',
    goal: 'Aprender',
    target_date: null,
    sources: [{ source_id: 'src-1', title: 'Fuente', primary: true }],
    sections: [
      {
        id: 'S01',
        title: 'Sección 1',
        modules: [
          {
            id: 'S01M1',
            title: 'Módulo 1',
            objectives: [],
            concept_ids: [],
            lessons: [
              {
                id: 'S01M1L1',
                kind: 'core',
                title: 'Lección 1',
                concept_ids: ['c1', 'c2'],
                warmup_concept_ids: [],
                objectives: [],
                prerequisite_lesson_ids: [],
                estimated_minutes: 10,
                source_refs: [],
                origin: 'model',
              },
            ],
            reinforcement: {
              id: 'S01M1.reinf',
              kind: 'reinforcement',
              module_id: 'S01M1',
              concept_ids: [],
              earlier_concept_ids: [],
              item_count: 5,
              estimated_minutes: 5,
            },
            checkpoint: null,
            estimated_minutes: 15,
          },
        ],
      },
    ],
    final_exam: {
      id: 'FINAL',
      kind: 'final_exam',
      blueprint: { topics: [], item_count: 0 },
      estimated_minutes: 0,
    },
    misconceptions: [],
    excluded: [],
    stats: {
      sections: 1,
      modules: 1,
      lessons: 1,
      checkpoints: 0,
      concepts: 2,
      minutes: 15,
      weeks_estimate: null,
    },
    warnings: [],
    known_node_ids: [],
    ...overrides,
  })
}

function makePath(overrides: Partial<LearningPath> = {}): LearningPath {
  return {
    id: 'path-1',
    title: 'Curso',
    language: 'es-AR',
    level: 'beginner',
    goal: 'Aprender',
    targetDate: null,
    status: 'draft',
    activeVersion: null,
    sourceIds: ['src-1'],
    settings: null,
    createdAt: clock.now(),
    updatedAt: clock.now(),
    deletedAt: null,
    deviceId: 'test',
    version: 1,
    ...overrides,
  }
}

function makeVersion(overrides: Partial<PathVersion> = {}): PathVersion {
  return {
    id: 'version-1',
    pathId: 'path-1',
    number: 1,
    spec: draft() as unknown as PathVersion['spec'],
    knowledgeGraph: null,
    manifest: null,
    diff: null,
    frozenAt: null,
    createdAt: clock.now(),
    updatedAt: clock.now(),
    deletedAt: null,
    deviceId: 'test',
    version: 1,
    ...overrides,
  }
}

const zeroStage = {
  calls: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  usd: 0,
}

function makeEstimate(p2ModulesOverrides: { usd: number; calls: number }) {
  return {
    chunks: 0,
    concepts: 0,
    modules: 0,
    p1: zeroStage,
    p2Outline: zeroStage,
    p2Modules: { ...zeroStage, ...p2ModulesOverrides },
    usd: 0,
    lowUsd: 0,
    highUsd: 0,
    minutes: { low: 0, high: 0 },
    dispatch: 'sync' as const,
    priced: { cheap: true, smart: true },
  }
}

function makeRun(overrides: Partial<GenerationRun> = {}): GenerationRun {
  return {
    id: 'run-1',
    pathId: 'path-1',
    pathVersionId: 'version-1',
    status: 'completed',
    config: {},
    configHash: 'x'.repeat(64),
    progress: { stage: 'persisting', done: 1, total: 1 },
    estimate: null,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    manifest: null,
    warnings: [],
    error: null,
    startedAt: clock.now(),
    finishedAt: clock.now(),
    createdAt: clock.now(),
    updatedAt: clock.now(),
    deletedAt: null,
    deviceId: 'test',
    version: 1,
    ...overrides,
  }
}

function makeRepos(
  version: PathVersion,
  path: LearningPath,
): PathgenFacadeRepos & {
  updateVersion: ReturnType<typeof vi.fn>
} {
  const updateVersion = vi.fn(async (_id: string, patch: { spec?: unknown }) => ({
    ...version,
    ...(patch.spec === undefined ? {} : { spec: patch.spec as PathVersion['spec'] }),
  }))
  const sectionRow: Section = {
    id: 'sec-row-1',
    pathVersionId: version.id,
    ordinal: 0,
    specId: 'S01',
    title: 'Sección 1',
    unlockRule: null,
    xpReward: 0,
    createdAt: clock.now(),
    updatedAt: clock.now(),
    deletedAt: null,
    deviceId: 'test',
    version: 1,
  }
  const moduleRow: Module = {
    id: 'mod-row-1',
    sectionId: sectionRow.id,
    ordinal: 0,
    specId: 'S01M1',
    title: 'Módulo 1',
    objectives: [],
    diagnosticItemIds: [],
    unlockRule: null,
    xpReward: 0,
    createdAt: clock.now(),
    updatedAt: clock.now(),
    deletedAt: null,
    deviceId: 'test',
    version: 1,
  }
  const lessonRows: Lesson[] = []
  const frozen = { ...version, frozenAt: clock.now() }
  const activePath = { ...path, activeVersion: version.number, status: 'active' as const }
  const tree: PathTree = {
    path: activePath,
    version: frozen,
    sections: [{ ...sectionRow, modules: [{ ...moduleRow, lessons: [] }] }],
  }

  return {
    paths: {
      findVersion: vi.fn(async (id: string) => (id === version.id ? version : undefined)),
      findById: vi.fn(async (id: string) => (id === path.id ? path : undefined)),
      update: vi.fn(async () => activePath),
      updateVersion,
      createSection: vi.fn(async () => sectionRow),
      createModule: vi.fn(async () => moduleRow),
      createLesson: vi.fn(async (input: { specId: string }) => {
        const row = { id: `lesson-${lessonRows.length}`, ...input } as unknown as Lesson
        lessonRows.push(row)
        return row
      }),
      freezeVersion: vi.fn(async () => frozen),
      setActiveVersion: vi.fn(async () => activePath),
      loadTree: vi.fn(async () => tree),
      findSection: vi.fn(async () => sectionRow),
      findModule: vi.fn(async () => moduleRow),
      findLesson: vi.fn(async (id: string) => lessonRows.find((row) => row.id === id)),
      listActivities: vi.fn(async () => []),
    },
    generationRuns: {
      findById: vi.fn(async (id: string) => (id === 'run-1' ? makeRun() : undefined)),
      findLatestByPath: vi.fn(async () => undefined),
    },
    knowledgeItems: {
      listByLesson: vi.fn(async () => []),
    },
    updateVersion,
  }
}

function makeExpansion() {
  return {
    expand: vi.fn(async () => ({
      runId: 'run-1',
      pathId: 'path-1',
      pathVersionId: 'version-1',
      status: 'completed' as const,
      stage: null as never,
      warnings: [],
      error: null,
    })),
    resume: vi.fn(),
    active: vi.fn(async () => []),
  }
}

function makeRuns() {
  return {
    start: vi.fn(async () => ({
      runId: 'run-1',
      pathId: 'path-1',
      pathVersionId: 'version-1',
      status: 'completed' as const,
      manifest: null,
      warnings: [],
      draft: draft(),
      error: null,
    })),
    resume: vi.fn(),
    cancel: vi.fn(async () => makeRun({ status: 'cancelled' })),
    active: vi.fn(() => []),
  }
}

describe('createPathgenFacade()', () => {
  it('getVersion reads the draft out of the version spec', async () => {
    const version = makeVersion()
    const path = makePath()
    const repos = makeRepos(version, path)
    const facade = createPathgenFacade({
      runs: makeRuns(),
      expansion: makeExpansion(),
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
    })

    const result = await facade.getVersion({ pathVersionId: version.id })
    expect(result.path.id).toBe('path-1')
    expect(result.draft.sections[0]?.id).toBe('S01')
  })

  it('editDraft rejects once the version is frozen', async () => {
    const version = makeVersion({ frozenAt: clock.now() })
    const repos = makeRepos(version, makePath())
    const facade = createPathgenFacade({
      runs: makeRuns(),
      expansion: makeExpansion(),
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
    })

    await expect(
      facade.editDraft({
        pathVersionId: version.id,
        op: { kind: 'rename', nodeId: 'S01', title: 'x' },
      }),
    ).rejects.toThrow(/frozen/)
    expect(repos.updateVersion).not.toHaveBeenCalled()
  })

  it('editDraft applies a rename and persists the updated spec', async () => {
    const version = makeVersion()
    const repos = makeRepos(version, makePath())
    const facade = createPathgenFacade({
      runs: makeRuns(),
      expansion: makeExpansion(),
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
    })

    const result = await facade.editDraft({
      pathVersionId: version.id,
      op: { kind: 'rename', nodeId: 'S01', title: 'Nueva sección' },
    })
    expect(result.draft.sections[0]?.title).toBe('Nueva sección')
    expect(repos.updateVersion).toHaveBeenCalledWith(
      version.id,
      expect.objectContaining({ spec: expect.objectContaining({ sections: expect.any(Array) }) }),
    )
  })

  it('editDraft prices deepenLesson from the path’s latest run estimate', async () => {
    const version = makeVersion()
    const repos = makeRepos(version, makePath())
    repos.generationRuns.findLatestByPath = vi.fn(async () =>
      makeRun({
        estimate: makeEstimate({ usd: 1, calls: 4 }) as unknown as GenerationRun['estimate'],
      }),
    )
    const facade = createPathgenFacade({
      runs: makeRuns(),
      expansion: makeExpansion(),
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
    })

    const result = await facade.editDraft({
      pathVersionId: version.id,
      op: { kind: 'deepenLesson', lessonId: 'S01M1L1', parts: 2 },
    })
    expect(result.projectedCostDeltaUsd).toBeCloseTo(0.25)
  })

  it('freeze returns the pre-freeze draft’s own stats', async () => {
    const version = makeVersion()
    const path = makePath()
    const repos = makeRepos(version, path)
    const facade = createPathgenFacade({
      runs: makeRuns(),
      expansion: makeExpansion(),
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
    })

    const result = await facade.freeze({ pathVersionId: version.id })
    expect(result.stats).toEqual(draft().stats)
    expect(repos.paths.freezeVersion).toHaveBeenCalledWith(version.id, clock.now())
  })

  it('start/cancel/quote delegate to the run handle and the bound quote function', async () => {
    const version = makeVersion()
    const repos = makeRepos(version, makePath())
    const runs = makeRuns()
    const quote = vi.fn(async () => ({ estimate: { usd: 1 } as never, warnings: [] }))
    const facade = createPathgenFacade({ runs, expansion: makeExpansion(), repos, clock, quote })

    const started = await facade.start({
      config: { goal: 'g', level: 'l', primarySourceId: 's', sourceIds: ['s'] },
    })
    expect(started.runId).toBe('run-1')
    expect(runs.start).toHaveBeenCalled()

    const cancelled = await facade.cancel({ runId: 'run-1' })
    expect(cancelled.run?.status).toBe('cancelled')

    const quoted = await facade.quote({
      config: { goal: 'g', level: 'l', primarySourceId: 's', sourceIds: ['s'] },
    })
    expect(quoted.estimate).toEqual({ usd: 1 })
    expect(quote).toHaveBeenCalled()
  })
})
