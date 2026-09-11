import type {
  AiGrader,
  GenerationRun,
  LearningPath,
  Lesson,
  Module,
  PathTree,
  PathVersion,
  Remediation,
  Section,
} from '@retenia/core'
import { remediationDecisionDtoSchema, versionDiffDtoSchema } from '@retenia/ipc-contract'
import type {
  AffectedResult,
  PathDraft,
  RemediationDecision,
  RemediationService,
} from '@retenia/pathgen'
import { diffDrafts, pathDraftSchema } from '@retenia/pathgen'
import { describe, expect, it, vi } from 'vitest'
import type { DiagnosticService } from './diagnostic-service'
import { createPathgenFacade, type PathgenFacadeRepos } from './facade'

// The facade logs the freeze hook's failures (8.5), and the logger pulls in Electron.
vi.mock('../logging/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

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
      findVersionByNumber: vi.fn(async () => undefined),
      findById: vi.fn(async (id: string) => (id === path.id ? path : undefined)),
      update: vi.fn(async () => activePath),
      updateVersion,
      updateLesson: vi.fn(async (id: string) => lessonRows.find((row) => row.id === id) as Lesson),
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
      update: vi.fn(),
    },
    chunks: {
      findById: vi.fn(async () => undefined),
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
  it('exposes the P10 long-text grader deps.longTextGrader was built with, or null without one', async () => {
    const version = makeVersion()
    const repos = makeRepos(version, makePath())
    const grader: AiGrader = vi.fn()
    const withGrader = createPathgenFacade({
      runs: makeRuns(),
      expansion: makeExpansion(),
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
      longTextGrader: grader,
    })
    expect(withGrader.longTextGrader).toBe(grader)

    const withoutGrader = createPathgenFacade({
      runs: makeRuns(),
      expansion: makeExpansion(),
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
    })
    expect(withoutGrader.longTextGrader).toBeNull()
  })

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

describe('createPathgenFacade().getQaReport (sub-phase 8.4)', () => {
  it('lists every core lesson with its verdict and resolves a finding’s citation to a page', async () => {
    const version = makeVersion({ frozenAt: clock.now() })
    const path = makePath()
    const repos = makeRepos(version, path)
    const lesson = {
      id: '019213cd-0000-7000-8000-000000000020',
      moduleId: 'mod-row-1',
      ordinal: 0,
      specId: 'S01M1L1',
      kind: 'core' as const,
      parentLessonId: null,
      title: 'Lección 1',
      status: 'ready' as const,
      objectives: [],
      conceptIds: ['c1'],
      prerequisiteLessonIds: [],
      estimatedMinutes: 10,
      theory: null,
      citations: [
        {
          id: 'B01',
          source_id: '019213cd-0000-7000-8000-00000000003a',
          chunk_id: 'chunk-1',
          block_ids: ['b1'],
          locator: 'p. 8',
          quote: null,
        },
      ],
      qa: {
        faithfulness: 0.5,
        pedagogy_score: 3,
        coverage_ok: true,
        warnings: [],
        version: 1,
        run_id: 'run-1',
        at: clock.now().toISOString(),
        mode: 'full',
        verdict: 'flagged',
        reviewed: true,
        sources_count: 1,
        iterations: { edit: 0, regenerate: 1 },
        gates: [{ gate: 'faithfulness', outcome: 'regenerate' }],
        criteria: [],
        findings: [
          {
            gate: 'faithfulness',
            kind: 'claim_unsupported',
            block_index: 1,
            sentence: 'Retiene siete.',
            citation_ids: ['B01', 'B99'],
            detail: 'la fuente dice cuatro',
          },
        ],
        cost: { usd: 0.01, calls: 2, cache_hits: 0 },
        models: { p6: 'gemini-3.7-flash', p7: 'gemini-3.7-flash', p8: null },
      },
      expansion: null,
      remediation: null,
      unlockRule: null,
      xpReward: 0,
      completedAt: null,
      createdAt: clock.now(),
      updatedAt: clock.now(),
      deletedAt: null,
      deviceId: 'test',
      version: 1,
    } as unknown as Lesson
    const tree = (await repos.paths.loadTree(version.id)) as PathTree
    const module = tree.sections[0]?.modules[0] as PathTree['sections'][number]['modules'][number]
    repos.paths.loadTree = vi.fn(async () => ({
      ...tree,
      sections: [
        {
          ...(tree.sections[0] as PathTree['sections'][number]),
          modules: [{ ...module, lessons: [{ ...lesson, activities: [] }] }],
        },
      ],
    })) as never
    repos.chunks.findById = vi.fn(async () => ({
      id: 'chunk-1',
      sourceId: '019213cd-0000-7000-8000-00000000003a',
      unitId: null,
      locator: { page: 8, block_ids: ['b1'] },
    })) as never
    const facade = createPathgenFacade({
      runs: makeRuns(),
      expansion: makeExpansion(),
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
    })

    const report = await facade.getQaReport({ pathVersionId: version.id })
    expect(report.totals).toEqual({ lessons: 1, reviewed: 1, flagged: 1, meanFaithfulness: 0.5 })
    const [row] = report.lessons
    expect(row?.qa).toMatchObject({ verdict: 'flagged', faithfulness: 0.5, sourcesCount: 1 })
    expect(row?.findings).toHaveLength(1)
    // B01 resolves to the chunk's page; B99 names nothing the lesson stores and is left out.
    expect(row?.findings[0]?.citations).toEqual([
      {
        id: 'B01',
        sourceId: '019213cd-0000-7000-8000-00000000003a',
        locator: 'p. 8',
        page: 8,
        blockIds: ['b1'],
      },
    ])
  })
})

describe('createPathgenFacade() remediation and regeneration (sub-phase 8.6)', () => {
  function makeRemediationRow(overrides: Partial<Remediation> = {}): Remediation {
    return {
      id: '019213cd-0000-7000-8000-0000000000a1',
      pathVersionId: 'version-1',
      moduleId: 'mod-row-1',
      conceptId: 'c1',
      misconceptionId: null,
      trigger: 'confident_error',
      status: 'active',
      refusal: null,
      anchorLessonId: null,
      lessonId: 'lesson-r1',
      specId: 'S01M1L1.r1',
      evidence: {},
      boost: { card_ids: [], expires_at: null, clean: {}, cleared: [] },
      outcome: null,
      resolvedAt: null,
      createdAt: clock.now(),
      updatedAt: clock.now(),
      deletedAt: null,
      deviceId: 'test',
      version: 1,
      ...overrides,
    }
  }

  function makeRemediationLesson(overrides: Partial<Lesson> = {}): Lesson {
    return {
      id: 'lesson-r1',
      moduleId: 'mod-row-1',
      ordinal: 1,
      specId: 'S01M1L1.r1',
      kind: 'remediation',
      parentLessonId: null,
      title: 'Repaso',
      status: 'ready',
      objectives: [],
      conceptIds: ['c1'],
      prerequisiteLessonIds: [],
      estimatedMinutes: 4,
      theory: null,
      citations: [],
      qa: null,
      expansion: null,
      remediation: null,
      unlockRule: null,
      xpReward: 0,
      completedAt: null,
      createdAt: clock.now(),
      updatedAt: clock.now(),
      deletedAt: null,
      deviceId: 'test',
      version: 1,
      ...overrides,
    }
  }

  function makeDiagnosticStateDto(status: 'completed' | 'in_progress') {
    return {
      session: {
        id: '019213cd-0000-7000-8000-0000000000d1',
        pathVersionId: 'version-1',
        status,
        entry: 'partial' as const,
        startedAt: clock.now().toISOString(),
        finishedAt: status === 'completed' ? clock.now().toISOString() : null,
        stopReason: status === 'completed' ? ('from_scratch' as const) : null,
      },
      progress: { asked: 0, remaining: 0, elapsedMs: 0, maxItems: 30 },
      item: null,
      result: null,
    }
  }

  function makeDiagnosticsFake(
    state: ReturnType<typeof makeDiagnosticStateDto>,
  ): DiagnosticService {
    return {
      get: vi.fn(),
      start: vi.fn(),
      answer: vi.fn(),
      finish: vi.fn(async () => state),
      revert: vi.fn(),
      recordPreviewKnown: vi.fn(async () => {}),
      onLessonExpanded: vi.fn(async () => {}),
      sweepPendingSeeds: vi.fn(async () => 0),
      verifyKnownModules: vi.fn(async () => ({ reopened: 0 })),
      reopenModule: vi.fn(async () => false),
    } as unknown as DiagnosticService
  }

  it('regenerate uses the path’s settings as config when none is given', async () => {
    const version = makeVersion()
    const settings = { goal: 'g', level: 'l', primarySourceId: 's', sourceIds: ['s'] }
    const path = makePath({
      activeVersion: 1,
      settings: settings as unknown as LearningPath['settings'],
    })
    const repos = makeRepos(version, path)
    const runs = makeRuns()
    const facade = createPathgenFacade({
      runs,
      expansion: makeExpansion(),
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
    })

    const result = await facade.regenerate({ pathId: path.id })
    expect(result.runId).toBe('run-1')
    expect(runs.start).toHaveBeenCalledWith(settings, { pathId: path.id })
  })

  it('regenerate lets an explicit config win over the path’s settings', async () => {
    const version = makeVersion()
    const settings = { goal: 'g', level: 'l', primarySourceId: 's', sourceIds: ['s'] }
    const path = makePath({
      activeVersion: 1,
      settings: settings as unknown as LearningPath['settings'],
    })
    const repos = makeRepos(version, path)
    const runs = makeRuns()
    const facade = createPathgenFacade({
      runs,
      expansion: makeExpansion(),
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
    })
    const config = { goal: 'g2', level: 'l2', primarySourceId: 's2', sourceIds: ['s2'] }

    await facade.regenerate({ pathId: path.id, config })
    expect(runs.start).toHaveBeenCalledWith(config, { pathId: path.id })
  })

  it('regenerate refuses a path with no frozen version to regenerate', async () => {
    const version = makeVersion()
    const path = makePath({ activeVersion: null })
    const repos = makeRepos(version, path)
    const facade = createPathgenFacade({
      runs: makeRuns(),
      expansion: makeExpansion(),
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
    })

    await expect(facade.regenerate({ pathId: path.id })).rejects.toThrow(/no frozen version/)
  })

  it('versionDiff returns the stored diff’s DTO', async () => {
    const previousDraft = draft()
    const nextDraft = draft({ title: 'Curso v2' })
    const diff = diffDrafts(previousDraft, nextDraft, { from: 1, to: 2 })
    const previousVersion = makeVersion({
      id: 'version-1prev',
      number: 1,
      spec: previousDraft as unknown as PathVersion['spec'],
      frozenAt: clock.now(),
    })
    const version = makeVersion({
      number: 2,
      diff: diff as unknown as PathVersion['diff'],
      spec: nextDraft as unknown as PathVersion['spec'],
      frozenAt: clock.now(),
    })
    const path = makePath({ activeVersion: 2 })
    const repos = makeRepos(version, path)
    repos.paths.findVersionByNumber = vi.fn(async (_pathId: string, number: number) =>
      number === 1 ? previousVersion : undefined,
    )
    const facade = createPathgenFacade({
      runs: makeRuns(),
      expansion: makeExpansion(),
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
    })

    const result = await facade.versionDiff({ pathVersionId: version.id })
    expect(result.diff).not.toBeNull()
    expect(versionDiffDtoSchema.safeParse(result.diff).success).toBe(true)
    expect(result.diff?.fromVersion).toBe(1)
    expect(result.diff?.toVersion).toBe(2)
  })

  it('versionDiff computes a live diff for an unfrozen draft against the active version', async () => {
    const activeDraft = draft()
    const draftDraft = draft({ title: 'Curso regenerado' })
    const activeVersion = makeVersion({
      id: 'version-1active',
      number: 1,
      spec: activeDraft as unknown as PathVersion['spec'],
      frozenAt: clock.now(),
    })
    const draftVersion = makeVersion({
      id: 'version-2draft',
      number: 2,
      spec: draftDraft as unknown as PathVersion['spec'],
      diff: null,
      frozenAt: null,
    })
    const path = makePath({ activeVersion: 1 })
    const repos = makeRepos(draftVersion, path)
    repos.paths.findVersionByNumber = vi.fn(async (_pathId: string, number: number) =>
      number === 1 ? activeVersion : undefined,
    )
    const facade = createPathgenFacade({
      runs: makeRuns(),
      expansion: makeExpansion(),
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
    })

    const result = await facade.versionDiff({ pathVersionId: draftVersion.id })
    expect(result.diff).not.toBeNull()
    expect(versionDiffDtoSchema.safeParse(result.diff).success).toBe(true)
    expect(result.diff?.fromVersion).toBe(1)
    expect(result.diff?.toVersion).toBe(2)
  })

  it('versionDiff returns null for a first version', async () => {
    const version = makeVersion({ number: 1, diff: null, frozenAt: clock.now() })
    const path = makePath({ activeVersion: 1 })
    const repos = makeRepos(version, path)
    const facade = createPathgenFacade({
      runs: makeRuns(),
      expansion: makeExpansion(),
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
    })

    expect(await facade.versionDiff({ pathVersionId: version.id })).toEqual({ diff: null })
  })

  it('regenerateAffected expands only the requested affected lessons', async () => {
    // Paid work runs only on the frozen version the learner is studying.
    const version = makeVersion({ frozenAt: clock.now() })
    const path = makePath({ activeVersion: version.number, status: 'active' })
    const repos = makeRepos(version, path)
    const expansion = makeExpansion()
    const affectedResult: AffectedResult = {
      sources: [],
      lessons: [
        { lessonId: 'l1', specId: 'S01M1L1', title: 'L1', sourceIds: [], missingFragments: 1 },
        { lessonId: 'l2', specId: 'S01M1L2', title: 'L2', sourceIds: [], missingFragments: 1 },
      ],
    }
    const affected = vi.fn(async () => affectedResult)
    const facade = createPathgenFacade({
      runs: makeRuns(),
      expansion,
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
      affected,
    })

    const result = await facade.regenerateAffected({ pathVersionId: version.id, lessonIds: ['l1'] })
    expect(affected).toHaveBeenCalledWith(version.id)
    expect(expansion.expand).toHaveBeenCalledWith(version.id, {
      userWaiting: true,
      regenerate: true,
      onlyLessonIds: ['S01M1L1'],
    })
    expect(result.lessons).toBe(1)
    expect(result.run?.id).toBe('run-1')
  })

  it('regenerateAffected returns { run: null, lessons: 0 } when nothing is affected', async () => {
    const version = makeVersion({ frozenAt: clock.now() })
    const path = makePath({ activeVersion: version.number, status: 'active' })
    const repos = makeRepos(version, path)
    const expansion = makeExpansion()
    const affected = vi.fn(async (): Promise<AffectedResult> => ({ sources: [], lessons: [] }))
    const facade = createPathgenFacade({
      runs: makeRuns(),
      expansion,
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
      affected,
    })

    const result = await facade.regenerateAffected({ pathVersionId: version.id })
    expect(result).toEqual({ run: null, lessons: 0 })
    expect(expansion.expand).not.toHaveBeenCalled()
  })

  it('remediationRequest maps the first decision of remediation.handle() to a DTO that parses', async () => {
    const version = makeVersion()
    const path = makePath()
    const repos = makeRepos(version, path)
    // The DTO crosses the bridge, so every id in it has to be a UUID the contract accepts.
    const lessonId = '019213cd-0000-7000-8000-0000000000b3'
    const row = makeRemediationRow({
      pathVersionId: '019213cd-0000-7000-8000-0000000000b1',
      moduleId: '019213cd-0000-7000-8000-0000000000b2',
      lessonId,
    })
    const lesson = makeRemediationLesson({ id: lessonId, moduleId: row.moduleId as string })
    const decision: RemediationDecision = { kind: 'inserted', remediation: row, lesson }
    const remediation: RemediationService = {
      handle: vi.fn(async () => [decision]),
      list: vi.fn(async () => []),
      complete: vi.fn(async () => row),
      dismiss: vi.fn(async () => row),
      sweep: vi.fn(async () => 0),
      retire: vi.fn(async () => 0),
    }
    const facade = createPathgenFacade({
      runs: makeRuns(),
      expansion: makeExpansion(),
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
      remediation,
    })

    const result = await facade.remediationRequest({ lessonId, conceptId: 'c1' })
    expect(remediation.handle).toHaveBeenCalledWith({
      kind: 'not_understood',
      lessonId,
      conceptId: 'c1',
    })
    expect(remediationDecisionDtoSchema.safeParse(result).success).toBe(true)
    expect(result.kind).toBe('inserted')
    expect(result.remediation?.id).toBe(row.id)
  })

  it('remediation methods throw when remediation is not available', async () => {
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

    await expect(facade.remediationList({ pathVersionId: version.id })).rejects.toThrow(
      /remediation is not available/,
    )
    await expect(facade.remediationRequest({ lessonId: 'lesson-r1' })).rejects.toThrow(
      /remediation is not available/,
    )
    await expect(facade.remediationComplete({ remediationId: 'r1' })).rejects.toThrow(
      /remediation is not available/,
    )
    await expect(facade.remediationDismiss({ remediationId: 'r1' })).rejects.toThrow(
      /remediation is not available/,
    )
  })

  it('diagnosticFinish calls onDiagnosticCompleted() when the session completed', async () => {
    const version = makeVersion()
    const path = makePath()
    const repos = makeRepos(version, path)
    const completed = makeDiagnosticStateDto('completed')
    const diagnostics = makeDiagnosticsFake(completed)
    const onDiagnosticCompleted = vi.fn(async () => {})
    const facade = createPathgenFacade({
      runs: makeRuns(),
      expansion: makeExpansion(),
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
      diagnostics,
      onDiagnosticCompleted,
    })

    await facade.diagnosticFinish({ sessionId: completed.session.id })
    // The hook fires asynchronously, after the state is returned.
    await Promise.resolve()
    await Promise.resolve()
    expect(onDiagnosticCompleted).toHaveBeenCalledWith(completed.session.id)
  })

  it('diagnosticFinish does not call onDiagnosticCompleted() for an in-progress session', async () => {
    const version = makeVersion()
    const path = makePath()
    const repos = makeRepos(version, path)
    const inProgress = makeDiagnosticStateDto('in_progress')
    const diagnostics = makeDiagnosticsFake(inProgress)
    const onDiagnosticCompleted = vi.fn(async () => {})
    const facade = createPathgenFacade({
      runs: makeRuns(),
      expansion: makeExpansion(),
      repos,
      clock,
      quote: async () => ({ estimate: null as never, warnings: [] }),
      diagnostics,
      onDiagnosticCompleted,
    })

    await facade.diagnosticFinish({ sessionId: inProgress.session.id })
    await Promise.resolve()
    await Promise.resolve()
    expect(onDiagnosticCompleted).not.toHaveBeenCalled()
  })
})
