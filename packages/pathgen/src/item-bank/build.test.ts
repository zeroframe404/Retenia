import type {
  ActivityRejection,
  AuthoredItem,
  Clock,
  ExamForm,
  ItemAuthorRequest,
  Lesson,
} from '@retenia/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { normalizeTerm } from '../consolidate/normalize'
import { difficultyLogitOf } from '../diagnostic/elo'
import { GenerationError } from '../errors'
import { silentLogger } from '../logger'
import { warning } from '../schemas/warnings'
import { testPrompts } from '../testing/extract-fixtures'
import {
  createItemBankRepos,
  type ItemBankMemoryRepos,
  itemBankWorld,
} from '../testing/item-bank-world'
import { type Blueprint, type BlueprintCell, buildBlueprint, cellItemCount } from './blueprint'
import { buildItemBank, examCellsDue, type ItemBankDeps } from './build'
import type { ItemAuthor } from './item-author'

/**
 * `buildItemBank()` end to end over in-memory repositories: a fake `ItemAuthor` whose
 * `plan()`/`collect()` are fully scripted per blueprint cell, and a fake `ai.structured` that
 * never has to produce a real answer, because the fake author never reads its value — exactly
 * the split `expand-lessons.test.ts` draws for P4, for the same reason (the real author's
 * validation lives in `@retenia/activity-ai`'s own suite).
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const clock: Clock = { now: () => NOW }

const FAKE_SCHEMA = z.object({ ok: z.boolean() })

interface CellScript {
  readonly items?: readonly AuthoredItem[]
  readonly rejected?: readonly ActivityRejection[]
  readonly injectionSuspected?: boolean
}

/** One item per slot the cell wants, stems unique and never colliding with the fixture's
 *  lesson activities — the baseline every cell gets unless a test scripts something else. */
function defaultItemsFor(cell: BlueprintCell): AuthoredItem[] {
  const slots = cell.difficulties.flatMap((difficulty) =>
    cell.forms.length === 0
      ? [{ difficulty, form: null as ExamForm | null }]
      : cell.forms.map((form) => ({ difficulty, form })),
  )
  return slots.map((slot, index) =>
    itemAt(cell, slot.form, slot.difficulty, `${cell.key} pregunta ${index}`, index),
  )
}

function itemAt(
  cell: Pick<BlueprintCell, 'key' | 'bloom'>,
  form: ExamForm | null,
  difficulty: number,
  stem: string,
  index = 0,
): AuthoredItem {
  return {
    key: `${cell.key}#${form ?? 'x'}#${difficulty}#${index}`,
    row: {
      type: 'mcq_single',
      family: 'choice',
      schemaVersion: 1,
      lang: 'es-AR',
      bloom: cell.bloom,
      difficulty,
      conceptIds: ['c1'],
      misconceptionIds: [],
      config: { prompt: stem, payload: { sets: [{ stem }] } },
      grading: { method: 'det' },
      status: 'ready',
      sourceRefs: [],
    },
    form,
    difficulty,
    conceptIds: ['c1'],
    misconceptionByOption: {},
    stem,
  }
}

/** A fake author whose `plan()` mints one call per cell and whose `collect()` answers from a
 *  script keyed by the cell's key, defaulting to `defaultItemsFor`. */
function fakeAuthor(scripts: Readonly<Record<string, CellScript>> = {}): ItemAuthor {
  const cellByCustomId = new Map<string, BlueprintCell>()
  return {
    plan: (request: ItemAuthorRequest) => {
      const cell = request.cell as BlueprintCell
      cellByCustomId.set(cell.key, cell)
      const script = scripts[cell.key] ?? {}
      return {
        customId: cell.key,
        cellKey: cell.key,
        structured: {
          prompt: `cell:${cell.key}`,
          temperature: 0.7,
          schema: FAKE_SCHEMA,
          schemaName: 'make_items',
          idempotencyKey: cell.key,
        } as never,
        batch: { customId: cell.key, request: { prompt: `cell:${cell.key}`, temperature: 0.7 } },
        injectionSuspected: script.injectionSuspected ?? false,
        misconceptionsAvailable: request.misconceptions.length > 0,
        conceptIds: request.concepts.map((c) => c.id),
        misconceptionIds: request.misconceptions.map((m) => m.id),
        forms: cell.forms,
      }
    },
    collect: (call) => {
      const cell = cellByCustomId.get(call.customId)
      const script = scripts[call.customId] ?? {}
      return {
        items: script.items ?? (cell === undefined ? [] : defaultItemsFor(cell)),
        rejected: script.rejected ?? [],
        notes: [],
      }
    },
  }
}

/** A fake `ai.structured`: any cell in `failCells` throws, everything else answers instantly.
 *  The fake author never reads `value`, so what it resolves to is arbitrary. */
function fakeAi(options: { failCells?: ReadonlySet<string> } = {}): Pick<ItemBankDeps, 'ai'>['ai'] {
  return {
    // Curried like the real client: `structured(binding)` returns the generator `runWave` calls.
    structured: () =>
      (async (request: { prompt?: string }) => {
        const prompt = request.prompt ?? ''
        const failing = [...(options.failCells ?? [])].some((key) => prompt === `cell:${key}`)
        if (failing) throw new Error('the model is unreachable')
        return {
          value: { ok: true },
          model: 'fake-model',
          usage: { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, usd: 0.001 },
          repairs: 0,
        }
      }) as never,
  }
}

function fakeEmbeddings(vectors: Readonly<Record<string, readonly number[]>>) {
  const map = new Map(
    Object.entries(vectors).map(([key, vector]) => [key, Float32Array.from(vector)]),
  )
  return {
    embed: async (keys: readonly string[]) =>
      keys.map((key) => map.get(key) ?? Float32Array.from([0, 0])),
  }
}

interface Fixture {
  readonly world: ReturnType<typeof itemBankWorld>
  readonly repos: ItemBankMemoryRepos
}

function setUp(worldOptions: Parameters<typeof itemBankWorld>[1] = {}): Fixture {
  const world = itemBankWorld(clock, worldOptions)
  return { world, repos: createItemBankRepos(clock, world.rows) }
}

/** The same computation `buildItemBank()` runs internally, so a test can predict cell keys
 *  and difficulties without re-deriving the blueprint algorithm by hand. */
function blueprintOf(fixture: Fixture): Blueprint {
  const draftModules = fixture.world.draft.sections.flatMap((section) => section.modules)
  return buildBlueprint({
    modules: draftModules.map((module) => ({
      id: module.id,
      objectiveBlooms: module.objectives.map((objective) => objective.bloom),
      conceptBlooms: [],
    })),
    topics: fixture.world.draft.final_exam.blueprint.topics,
    examItemCount: fixture.world.draft.final_exam.blueprint.item_count,
  })
}

function depsOf(fixture: Fixture, overrides: Partial<ItemBankDeps> = {}): ItemBankDeps {
  return {
    ai: fakeAi(),
    author: fakeAuthor(),
    repos: fixture.repos,
    prompts: testPrompts,
    clock,
    timers: { sleep: async () => {} },
    logger: silentLogger,
    ...overrides,
  }
}

function inputOf(
  fixture: Fixture,
  overrides: Partial<Parameters<typeof buildItemBank>[1]> = {},
): Parameters<typeof buildItemBank>[1] {
  return {
    pathVersionId: fixture.world.pathVersionId,
    allowOverBudget: true,
    userWaiting: true,
    ...overrides,
  }
}

function cellKeyOf(entry: { readonly authoring: Record<string, unknown> }): string | undefined {
  return entry.authoring.cell_key as string | undefined
}

describe('buildItemBank() — guard rails', () => {
  it('throws GenerationError for a missing path version', async () => {
    const fixture = setUp()
    await expect(
      buildItemBank(depsOf(fixture), inputOf(fixture, { pathVersionId: 'does-not-exist' })),
    ).rejects.toThrow(GenerationError)
  })

  it('throws GenerationError for an unfrozen path version', async () => {
    const fixture = setUp({ frozen: false })
    await expect(buildItemBank(depsOf(fixture), inputOf(fixture))).rejects.toThrow(GenerationError)
  })
})

describe('buildItemBank() — rows it writes', () => {
  let fixture: Fixture

  beforeEach(() => {
    fixture = setUp()
  })

  it('creates one item-bank-only activity and one item_bank row per kept item', async () => {
    const result = await buildItemBank(depsOf(fixture), inputOf(fixture))

    expect(result.status).toBe('completed')
    expect(result.cells.failed).toBe(0)
    expect(result.created).toBeGreaterThan(0)
    expect(fixture.repos.rows.itemBank).toHaveLength(result.created)

    for (const entry of fixture.repos.rows.itemBank) {
      const activity = fixture.repos.rows.activities.find((row) => row.id === entry.activityId)
      expect(activity).toBeDefined()
      expect(activity?.lessonId).toBeNull()
      expect(activity?.ordinal).toBeNull()
      expect(entry.exposure).toBe(0)
      expect(entry.stats).toEqual({ n: 0, p_correct: null })

      const authoring = entry.authoring as {
        cell_key: string
        stem: string
        difficulty: number
        misconception_by_option: Record<string, string>
      }
      expect(authoring.cell_key.length).toBeGreaterThan(0)
      expect(typeof authoring.stem).toBe('string')
      expect(authoring.misconception_by_option).toEqual({})
      expect(entry.difficultyLogit).toBeCloseTo(difficultyLogitOf(authoring.difficulty), 10)
    }
  })

  it('tags usage from the cell kind and form (usageFor)', async () => {
    await buildItemBank(depsOf(fixture), inputOf(fixture))
    const byKind = new Map(blueprintOf(fixture).cells.map((cell) => [cell.key, cell]))
    for (const entry of fixture.repos.rows.itemBank) {
      const key = cellKeyOf(entry)
      const cell = key === undefined ? undefined : byKind.get(key)
      if (cell === undefined) continue
      if (cell.kind === 'diagnostic') expect(entry.usage).toEqual(['diagnostic'])
      if (cell.kind === 'reinforcement')
        expect(entry.usage).toEqual(['reinforcement', 'remediation'])
      if (cell.kind === 'exam') {
        const form = (entry.authoring as { form: ExamForm | null }).form
        expect(entry.usage).toEqual(form === 'B' ? ['final_exam_B'] : ['final_exam_A', 'mock'])
      }
    }
  })

  it("keeps one A and one B per exam difficulty, and the candidate closest to the slot's difficulty", async () => {
    const blueprint = blueprintOf(fixture)
    const examCell = blueprint.cells.find((cell) => cell.kind === 'exam')
    if (examCell === undefined) throw new Error('the fixture has no exam cell')
    const target = examCell.difficulties[0] as number
    const items = (['A', 'B'] as const).flatMap((form) => [
      itemAt(examCell, form, target, `${form} cerca`),
      itemAt(examCell, form, target + 2, `${form} lejos`),
    ])
    const author = fakeAuthor({ [examCell.key]: { items } })

    await buildItemBank(depsOf(fixture, { author }), inputOf(fixture))

    const kept = fixture.repos.rows.itemBank.filter((entry) => cellKeyOf(entry) === examCell.key)
    expect(kept).toHaveLength(examCell.difficulties.length * 2)
    for (const entry of kept) {
      const authoring = entry.authoring as { stem: string }
      expect(authoring.stem).toContain('cerca')
    }
  })

  it("sets each module's diagnosticItemIds to its diagnostic bank items", async () => {
    await buildItemBank(depsOf(fixture), inputOf(fixture))
    const m01 = fixture.repos.rows.modules.find((module) => module.specId === 'M01')
    if (m01 === undefined) throw new Error('the fixture has no M01')
    const diagnosticEntries = fixture.repos.rows.itemBank.filter(
      (entry) => entry.moduleId === m01.id && entry.usage.includes('diagnostic'),
    )
    expect(diagnosticEntries.length).toBeGreaterThan(0)
    expect([...m01.diagnosticItemIds].sort()).toEqual(
      diagnosticEntries.map((entry) => entry.id).sort(),
    )
  })

  it('tallies byUsage across every kept item', async () => {
    const result = await buildItemBank(depsOf(fixture), inputOf(fixture))
    const total = Object.values(result.byUsage).reduce((sum, count) => sum + count, 0)
    expect(total).toBeGreaterThanOrEqual(result.created)
    expect(result.byUsage.diagnostic).toBeGreaterThan(0)
  })

  it('reports progress from 0 up to the number of planned cells', async () => {
    const seen: { done: number; total: number }[] = []
    const result = await buildItemBank(
      {
        ...depsOf(fixture),
        onProgress: (progress) => seen.push({ done: progress.done, total: progress.total }),
      },
      inputOf(fixture),
    )
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]).toEqual({ done: 0, total: result.cells.total })
    expect(seen.at(-1)).toEqual({ done: result.cells.total, total: result.cells.total })
  })
})

describe('buildItemBank() — dedupe against the lesson quizzes', () => {
  it('drops (item_duplicate) a candidate whose stem equals a lesson activity, after normalisation', async () => {
    const fixture = setUp()
    const blueprint = blueprintOf(fixture)
    const core = blueprint.cells.find(
      (cell) =>
        cell.kind === 'diagnostic' && cell.moduleId === 'M01' && cell.difficulties.length === 3,
    )
    if (core === undefined) throw new Error('the fixture has no M01 diagnostic|core cell')
    // Case, accents and punctuation differ from the lesson's own stem, but it is the same
    // question — the exact pass must still catch it.
    const shouted = 'LA MEMORIA DE TRABAJO RETIENE INFORMACION BREVE'
    const [d0, d1, d2] = core.difficulties as [number, number, number]
    const items = [
      itemAt(core, null, d0, shouted),
      itemAt(core, null, d0, 'Pregunta de reemplazo, distinta de la lección', 1),
      itemAt(core, null, d1, 'Otra pregunta más', 2),
      itemAt(core, null, d2, 'Y una tercera', 3),
    ]
    const author = fakeAuthor({ [core.key]: { items } })

    const result = await buildItemBank(depsOf(fixture, { author }), inputOf(fixture))

    expect(
      result.warnings.some((w) => w.code === 'item_duplicate' && w.params.reason === 'exact'),
    ).toBe(true)
    const kept = fixture.repos.rows.itemBank
      .filter((entry) => cellKeyOf(entry) === core.key)
      .map((entry) => (entry.authoring as { stem: string }).stem)
    expect(kept).not.toContain(shouted)
    expect(kept).toContain('Pregunta de reemplazo, distinta de la lección')
    expect(kept).toHaveLength(3)
  })

  it('drops a near-duplicate by cosine (> 0.92) and keeps one at or under the threshold', async () => {
    const fixture = setUp()
    const blueprint = blueprintOf(fixture)
    const reinforcement = blueprint.cells.find(
      (cell) => cell.kind === 'reinforcement' && cell.moduleId === 'M02',
    )
    if (reinforcement === undefined) throw new Error('the fixture has no M02 reinforcement cell')
    const lessonStem = '¿Qué produce una interferencia en la memoria de trabajo?'
    const nearDuplicate = 'Explica qué genera una interferencia en la memoria'
    const belowThreshold = 'Una formulación bastante distinta sobre la interferencia'
    const fallback = 'Otra pregunta totalmente distinta sobre el módulo'
    const plain = 'Una pregunta más sobre el módulo entero'
    const [d0, d1, d2] = reinforcement.difficulties as [number, number, number]
    const items = [
      itemAt(reinforcement, null, d0, nearDuplicate),
      itemAt(reinforcement, null, d0, fallback, 1),
      itemAt(reinforcement, null, d1, belowThreshold, 2),
      itemAt(reinforcement, null, d2, plain, 3),
    ]
    const author = fakeAuthor({ [reinforcement.key]: { items } })
    const embeddings = fakeEmbeddings({
      [normalizeTerm(lessonStem)]: [1, 0],
      [normalizeTerm(nearDuplicate)]: [0.95, Math.sqrt(1 - 0.95 ** 2)],
      [normalizeTerm(belowThreshold)]: [0.5, Math.sqrt(1 - 0.5 ** 2)],
    })

    const result = await buildItemBank(depsOf(fixture, { author, embeddings }), inputOf(fixture))

    expect(
      result.warnings.some((w) => w.code === 'item_duplicate' && w.params.reason === 'cosine'),
    ).toBe(true)
    const kept = fixture.repos.rows.itemBank
      .filter((entry) => cellKeyOf(entry) === reinforcement.key)
      .map((entry) => (entry.authoring as { stem: string }).stem)
    expect(kept).not.toContain(nearDuplicate)
    expect(kept).toContain(fallback)
    expect(kept).toContain(belowThreshold)
  })

  it('drops a B item identical to the A item already chosen for the same cell', async () => {
    const fixture = setUp()
    const blueprint = blueprintOf(fixture)
    const examCell = blueprint.cells.find((cell) => cell.kind === 'exam' && cell.moduleId === 'M01')
    if (examCell === undefined) throw new Error('the fixture has no M01 exam cell')
    const difficulty = examCell.difficulties[0] as number
    const shared = 'Misma pregunta exacta para las dos formas'
    const items = [
      itemAt(examCell, 'A', difficulty, shared),
      itemAt(examCell, 'B', difficulty, shared, 1),
      itemAt(examCell, 'B', difficulty, 'Pregunta B realmente distinta', 2),
    ]
    const author = fakeAuthor({ [examCell.key]: { items } })

    const result = await buildItemBank(depsOf(fixture, { author }), inputOf(fixture))

    expect(result.warnings.some((w) => w.code === 'item_duplicate')).toBe(true)
    const stemsB = fixture.repos.rows.itemBank
      .filter((entry) => cellKeyOf(entry) === examCell.key)
      .filter((entry) => (entry.authoring as { form: ExamForm | null }).form === 'B')
      .map((entry) => (entry.authoring as { stem: string }).stem)
    expect(stemsB).toEqual(['Pregunta B realmente distinta'])
  })
})

describe('buildItemBank() — when a cell comes up short or goes wrong', () => {
  it('reports item_bank_cell_short with the wanted and kept counts', async () => {
    const fixture = setUp()
    const blueprint = blueprintOf(fixture)
    const core = blueprint.cells.find(
      (cell) =>
        cell.kind === 'diagnostic' && cell.moduleId === 'M01' && cell.difficulties.length === 3,
    )
    if (core === undefined) throw new Error('the fixture has no M01 diagnostic|core cell')
    const items = [itemAt(core, null, core.difficulties[0] as number, 'Única pregunta disponible')]
    const author = fakeAuthor({ [core.key]: { items } })

    const result = await buildItemBank(depsOf(fixture, { author }), inputOf(fixture))

    const shortWarning = result.warnings.find((w) => w.code === 'item_bank_cell_short')
    expect(shortWarning?.params).toEqual({ cell: core.key, wanted: cellItemCount(core), kept: 1 })
    expect(result.cells.short).toBe(1)
  })

  it('reports a rejected candidate as item_rejected', async () => {
    const fixture = setUp()
    const blueprint = blueprintOf(fixture)
    const core = blueprint.cells[0] as BlueprintCell
    const author = fakeAuthor({
      [core.key]: {
        rejected: [
          { type: 'mcq_single', code: 'choice-single-correct-count', message: 'two keys' },
        ],
      },
    })

    const result = await buildItemBank(depsOf(fixture, { author }), inputOf(fixture))

    expect(result.warnings.map((w) => w.code)).toContain('item_rejected')
  })

  it('reports a call the author flagged as injection-suspected', async () => {
    const fixture = setUp()
    const blueprint = blueprintOf(fixture)
    const core = blueprint.cells[0] as BlueprintCell
    const author = fakeAuthor({ [core.key]: { injectionSuspected: true } })

    const result = await buildItemBank(depsOf(fixture, { author }), inputOf(fixture))

    expect(result.warnings.map((w) => w.code)).toContain('item_bank_injection_suspected')
  })

  it('fails one cell and still builds the rest', async () => {
    const fixture = setUp()
    const blueprint = blueprintOf(fixture)
    const failing = blueprint.cells[0] as BlueprintCell
    const ai = fakeAi({ failCells: new Set([failing.key]) })

    const result = await buildItemBank(depsOf(fixture, { ai }), inputOf(fixture))

    expect(
      result.warnings.some(
        (w) => w.code === 'item_bank_cell_failed' && w.params.cell === failing.key,
      ),
    ).toBe(true)
    expect(result.cells.failed).toBe(1)
    expect(result.cells.built).toBeGreaterThan(0)
    expect(fixture.repos.rows.itemBank.some((entry) => cellKeyOf(entry) === failing.key)).toBe(
      false,
    )
  })

  it('degrades to exact-only dedupe and reports embeddings_unavailable when the provider throws', async () => {
    const fixture = setUp()
    const embeddings = {
      embed: async (): Promise<Float32Array[]> => {
        throw new Error('the local model is not downloaded')
      },
    }

    const result = await buildItemBank(depsOf(fixture, { embeddings }), inputOf(fixture))

    expect(result.warnings.map((w) => w.code)).toContain('embeddings_unavailable')
    // The run still finished: the exact pass alone kept dedupe working.
    expect(result.status).toBe('completed')
    expect(result.created).toBeGreaterThan(0)
  })
})

describe('buildItemBank() — idempotent resume', () => {
  it('creates nothing on a second build; every cell counts as already built', async () => {
    const fixture = setUp()
    const first = await buildItemBank(depsOf(fixture), inputOf(fixture))
    expect(first.created).toBeGreaterThan(0)

    const again = await buildItemBank(depsOf(fixture), inputOf(fixture))

    expect(again.created).toBe(0)
    expect(again.cells.built).toBe(0)
    expect(again.cells.alreadyBuilt).toBe(again.cells.total)
  })
})

describe('buildItemBank() — the exam waits for the lessons and follows their coverage', () => {
  const isExam = (entry: { readonly authoring: Record<string, unknown> }) =>
    entry.authoring.kind === 'exam'
  const moduleIdOf = (fixture: Fixture, specId: string): string => {
    const module = fixture.repos.rows.modules.find((row) => row.specId === specId)
    if (module === undefined) throw new Error(`the fixture has no ${specId}`)
    return module.id
  }
  const setLesson = (fixture: Fixture, specId: string, patch: Partial<Lesson>) => {
    const index = fixture.repos.rows.lessons.findIndex((row) => row.specId === specId)
    fixture.repos.rows.lessons[index] = {
      ...(fixture.repos.rows.lessons[index] as Lesson),
      ...patch,
    }
  }
  const uncovered = (conceptId: string) =>
    ({
      warnings: [warning('concept_uncovered', { lesson: 'L01', concept_ids: [conceptId] })],
    }) as unknown as Lesson['qa']

  it('leaves the exam cells out while a core lesson is still being written, then builds them', async () => {
    const fixture = setUp()
    setLesson(fixture, 'L02', { status: 'generating' })

    const early = await buildItemBank(depsOf(fixture), inputOf(fixture))

    expect(early.examDeferred).toBe(true)
    const withoutExam = blueprintOf(fixture).cells.filter((cell) => cell.kind !== 'exam')
    expect(early.cells.total).toBe(withoutExam.length)
    expect(fixture.repos.rows.itemBank.some(isExam)).toBe(false)
    expect(fixture.repos.rows.exams).toEqual([])
    expect(await examCellsDue(fixture.repos, fixture.world.pathVersionId)).toBe(false)

    setLesson(fixture, 'L02', { status: 'ready' })
    expect(await examCellsDue(fixture.repos, fixture.world.pathVersionId)).toBe(true)

    const late = await buildItemBank(depsOf(fixture), inputOf(fixture))

    expect(late.examDeferred).toBe(false)
    expect(late.cells.alreadyBuilt).toBe(withoutExam.length)
    expect(fixture.repos.rows.itemBank.some(isExam)).toBe(true)
    expect(fixture.repos.rows.exams).toHaveLength(1)
    expect(fixture.repos.rows.exams[0]).toMatchObject({
      kind: 'final',
      date: null,
      pathId: fixture.world.pathId,
      status: 'planned',
      scope: { path_version_id: fixture.world.pathVersionId, exam_item_count: 4 },
    })
    expect(await examCellsDue(fixture.repos, fixture.world.pathVersionId)).toBe(false)
  })

  it('weighs a module by the coverage its lessons reached: an uncovered module gets no exam item', async () => {
    const fixture = setUp()
    setLesson(fixture, 'L01', { qa: uncovered('c1') })

    await buildItemBank(depsOf(fixture), inputOf(fixture))

    const exam = fixture.repos.rows.itemBank.filter(isExam)
    expect(exam.length).toBeGreaterThan(0)
    expect(new Set(exam.map((entry) => entry.moduleId))).toEqual(
      new Set([moduleIdOf(fixture, 'M02')]),
    )
    expect(fixture.repos.rows.exams[0]?.blueprint).toEqual([
      expect.objectContaining({ module_id: 'M01', weight: 0, coverage: 0, exam_items: 0 }),
      expect.objectContaining({ module_id: 'M02', weight: 1, coverage: 1, exam_items: 4 }),
    ])
    // The diagnostic still asks about M01: coverage only moves the exam.
    expect(
      fixture.repos.rows.itemBank.some(
        (entry) =>
          entry.moduleId === moduleIdOf(fixture, 'M01') && entry.usage.includes('diagnostic'),
      ),
    ).toBe(true)
  })

  it('counts a failed lesson as covering nothing', async () => {
    const fixture = setUp()
    setLesson(fixture, 'L01', { status: 'failed' })

    await buildItemBank(depsOf(fixture), inputOf(fixture))

    const exam = fixture.repos.rows.itemBank.filter(isExam)
    expect(exam.every((entry) => entry.moduleId === moduleIdOf(fixture, 'M02'))).toBe(true)
  })

  it('reuses the blueprint a previous build stored, whatever the lessons say now', async () => {
    const fixture = setUp()
    fixture.repos.rows.exams.push({
      id: 'exam-stored',
      title: 'Memoria',
      kind: 'final',
      date: null,
      pathId: fixture.world.pathId,
      scope: { path_version_id: fixture.world.pathVersionId, exam_item_count: 2 },
      blueprint: [
        { module_id: 'M01', weight: 1 },
        { module_id: 'M02', weight: 0 },
      ],
      targetRetention: 0.95,
      finalWindowDays: 3,
      studyDaysMask: 127,
      dailyCapacityMinutes: null,
      status: 'planned',
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      deviceId: 'test',
      version: 1,
    })

    const result = await buildItemBank(depsOf(fixture), inputOf(fixture))

    expect(result.blueprint.exam_item_count).toBe(2)
    const exam = fixture.repos.rows.itemBank.filter(isExam)
    expect(exam).toHaveLength(2 * 2)
    expect(exam.every((entry) => entry.moduleId === moduleIdOf(fixture, 'M01'))).toBe(true)
    expect(fixture.repos.rows.exams).toHaveLength(1)
  })

  it('still weighs by coverage without an exam repository, keeping nothing', async () => {
    const fixture = setUp()
    setLesson(fixture, 'L01', { qa: uncovered('c1') })
    const { exams: _exams, ...withoutExams } = fixture.repos

    await buildItemBank(depsOf(fixture, { repos: withoutExams }), inputOf(fixture))

    const exam = fixture.repos.rows.itemBank.filter(isExam)
    expect(exam.every((entry) => entry.moduleId === moduleIdOf(fixture, 'M02'))).toBe(true)
    expect(fixture.repos.rows.exams).toEqual([])
  })

  it('never adds a second final exam row beside one it cannot read', async () => {
    const fixture = setUp()
    setLesson(fixture, 'L01', { qa: uncovered('c1') })
    // A blueprint in some other shape — say one 10.2's editor imported from a syllabus.
    fixture.repos.rows.exams.push({
      id: 'exam-foreign',
      title: 'Memoria',
      kind: 'final',
      date: null,
      pathId: fixture.world.pathId,
      scope: { path_version_id: fixture.world.pathVersionId },
      blueprint: [{ topic: 'Unidad 1', share: 0.5 }],
      targetRetention: 0.95,
      finalWindowDays: 3,
      studyDaysMask: 127,
      dailyCapacityMinutes: null,
      status: 'planned',
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      deviceId: 'test',
      version: 1,
    })

    await buildItemBank(depsOf(fixture), inputOf(fixture))
    await buildItemBank(depsOf(fixture), inputOf(fixture))

    expect(fixture.repos.rows.exams).toHaveLength(1)
    expect(fixture.repos.rows.exams[0]?.blueprint).toEqual([{ topic: 'Unidad 1', share: 0.5 }])
    // The exam is still weighted by what the lessons covered.
    const exam = fixture.repos.rows.itemBank.filter(isExam)
    expect(exam.length).toBeGreaterThan(0)
    expect(exam.every((entry) => entry.moduleId === moduleIdOf(fixture, 'M02'))).toBe(true)
  })

  it('is never due for a version that is not frozen', async () => {
    const fixture = setUp({ frozen: false })
    expect(await examCellsDue(fixture.repos, fixture.world.pathVersionId)).toBe(false)
  })
})

describe('buildItemBank() — a module’s diagnostic items cover different concepts', () => {
  it('prefers a candidate on a concept the module’s other diagnostic items do not cover', async () => {
    const fixture = setUp()
    const blueprint = blueprintOf(fixture)
    const core = blueprint.cells.find(
      (cell) =>
        cell.kind === 'diagnostic' && cell.moduleId === 'M01' && cell.difficulties.length === 3,
    )
    const apply = blueprint.cells.find(
      (cell) =>
        cell.kind === 'diagnostic' && cell.moduleId === 'M01' && cell.difficulties.length === 1,
    )
    if (core === undefined || apply === undefined) {
      throw new Error('the fixture has no M01 diagnostic cells')
    }
    const on = (
      cell: BlueprintCell,
      concept: string,
      difficulty: number,
      stem: string,
      index: number,
    ) => ({ ...itemAt(cell, null, difficulty, stem, index), conceptIds: [concept] })
    // Every slot of the core cell has an exact-difficulty candidate on concept "cA"; only one
    // candidate, a step off in difficulty, is on "cB". The apply cell offers "cA" and "cC".
    const author = fakeAuthor({
      [core.key]: {
        items: [
          on(core, 'cA', 2, 'Primera sobre cA', 0),
          on(core, 'cA', 3, 'Segunda sobre cA', 1),
          on(core, 'cA', 3, 'Tercera sobre cA', 2),
          on(core, 'cB', 4, 'Única sobre cB', 3),
        ],
      },
      [apply.key]: {
        items: [
          on(apply, 'cA', 4, 'Aplicación sobre cA', 0),
          on(apply, 'cC', 4, 'Aplicación sobre cC', 1),
        ],
      },
    })

    await buildItemBank(depsOf(fixture, { author }), inputOf(fixture))

    const conceptsOf = (cellKey: string) =>
      fixture.repos.rows.itemBank
        .filter((row) => (row.authoring as { cell_key?: string }).cell_key === cellKey)
        .flatMap((row) => (row.authoring as { concept_ids?: string[] }).concept_ids ?? [])
    // "cB" wins the second slot over an exact-difficulty "cA"; the third slot, with nothing
    // else left, falls back to "cA" rather than coming up short.
    expect(conceptsOf(core.key)).toEqual(['cA', 'cB', 'cA'])
    // The apply cell skips "cA", which the core cell already covers.
    expect(conceptsOf(apply.key)).toEqual(['cC'])
  })
})
