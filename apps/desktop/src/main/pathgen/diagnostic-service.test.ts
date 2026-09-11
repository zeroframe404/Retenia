import { type ActivityDraft, toActivityRow } from '@retenia/activity-schema'
import type { Clock, JsonObject, UnitOfWork } from '@retenia/core'
import { CARD_STATE } from '@retenia/core'
import { createRepositories, type OpenedDatabase } from '@retenia/db'
import { openTestDatabase, testIds } from '@retenia/db/testing'
import type { DiagnosticStateDto } from '@retenia/ipc-contract'
import { difficultyLogitOf, freezePath, pathDraftSchema } from '@retenia/pathgen'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryService, type MemoryService } from '../memory/service'
import {
  createDiagnosticService,
  type DiagnosticMemory,
  type DiagnosticService,
  gradeChoiceResponse,
} from './diagnostic-service'

vi.mock('../logging/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

/**
 * The diagnostic in the main process (sub-phase 8.5) over a real SQLite file: the frozen tree
 * comes from the real `freezePath`, the items are real `activities` + `item_bank` rows, and
 * the seeding goes through the real memory service — so "seeded cards have exactly one review
 * log with context `diagnostic`" is checked against the real FSRS arithmetic and the real
 * append-only log, not a stub.
 */

let now = new Date('2026-09-11T12:00:00.000Z')
const clock: Clock = { now: () => now }

/** Two sections; M01 → M02 → M03 by prerequisite. Two concepts per module. */
function draftOf(knownNodeIds: string[] = []) {
  const lesson = (id: string, concepts: string[]) => ({
    id,
    kind: 'core' as const,
    title: `Lección ${id}`,
    concept_ids: concepts,
    warmup_concept_ids: [],
    objectives: [{ text: 'Explicar la idea', bloom: 'understand' as const }],
    prerequisite_lesson_ids: [],
    estimated_minutes: 10,
    source_refs: [],
    origin: 'model' as const,
  })
  const module = (id: string, concepts: string[], lessonId: string) => ({
    id,
    title: `Módulo ${id}`,
    objectives: [{ text: 'Aplicar la idea', bloom: 'apply' as const }],
    concept_ids: concepts,
    lessons: [lesson(lessonId, concepts)],
    reinforcement: {
      id: `${id}.reinf`,
      kind: 'reinforcement' as const,
      module_id: id,
      concept_ids: concepts,
      earlier_concept_ids: [],
      item_count: 10,
      estimated_minutes: 5,
    },
    checkpoint: null,
    estimated_minutes: 15,
  })
  return pathDraftSchema.parse({
    version: 1,
    kind: 'draft',
    title: 'Curso',
    language: 'es-AR',
    level: 'beginner',
    goal: 'Aprender',
    target_date: null,
    sources: [],
    sections: [
      {
        id: 'S01',
        title: 'Sección 1',
        modules: [module('M01', ['c1', 'c2'], 'L01'), module('M02', ['c3', 'c4'], 'L02')],
      },
      { id: 'S02', title: 'Sección 2', modules: [module('M03', ['c5', 'c6'], 'L03')] },
    ],
    final_exam: {
      id: 'FINAL',
      kind: 'final_exam',
      blueprint: { topics: [], item_count: 0 },
      estimated_minutes: 0,
    },
    misconceptions: [
      { id: 'X001', concept_id: 'c1', text: 'Una creencia', why_wrong: 'Porque no' },
    ],
    excluded: [],
    stats: {
      sections: 2,
      modules: 3,
      lessons: 3,
      checkpoints: 0,
      concepts: 6,
      minutes: 45,
      weeks_estimate: null,
    },
    warnings: [],
    known_node_ids: knownNodeIds,
  })
}

const GRAPH = {
  version: 1,
  embedding_model_id: null,
  threshold: 0.9,
  nodes: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((id) => ({
    concept_id: id,
    canonical: `Concepto ${id}`,
    aliases: [],
    definition: `Definición de ${id}`,
    kind: 'concept',
    bloom_target: 'understand',
    difficulty: 3,
    importance: 0.8,
    source_refs: [],
  })),
  edges: [
    { from: 'c1', to: 'c3', kind: 'PREREQ_OF', confidence: 0.9 },
    { from: 'c3', to: 'c5', kind: 'PREREQ_OF', confidence: 0.9 },
  ],
}

function itemDraft(concept: string, difficulty: number): ActivityDraft {
  return {
    schemaVersion: 1,
    type: 'mcq_single',
    family: 'choice',
    lang: 'es-AR',
    prompt: `¿Qué afirma la fuente sobre ${concept} (nivel ${difficulty})?`,
    skills: [concept],
    difficulty,
    grading: { method: 'det' },
    review: { eligible: true, ratingStrategy: 'binary', expectedSeconds: 12 },
    explanation: 'La primera opción es la que la fuente explica.',
    payload: {
      family: 'choice',
      sets: [
        {
          id: 's1',
          multiple: false,
          options: [
            { id: 'a', text: 'Lo que la fuente dice', correct: true, feedback: 'Correcto.' },
            { id: 'b', text: 'Lo que la fuente niega', correct: false, feedback: 'Al revés.' },
            { id: 'c', text: 'Lo que la fuente omite', correct: false, feedback: 'No está.' },
            {
              id: 'd',
              text: 'Lo que la fuente exagera',
              correct: false,
              feedback: 'Más de la cuenta.',
            },
          ],
        },
      ],
    },
  } as unknown as ActivityDraft
}

interface World {
  readonly opened: OpenedDatabase
  readonly repos: UnitOfWork
  readonly pathVersionId: string
  readonly moduleIds: Readonly<Record<string, string>>
  readonly sectionIds: Readonly<Record<string, string>>
  readonly lessonIds: Readonly<Record<string, string[]>>
  readonly itemModule: ReadonlyMap<string, string>
}

async function world(options: { knownNodeIds?: string[] } = {}): Promise<World> {
  const opened = openTestDatabase()
  const repos = createRepositories(opened, { deviceId: 'test', clock, ids: testIds(clock) })
  const path = await repos.paths.create({
    title: 'Curso',
    language: 'es-AR',
    level: 'beginner',
    goal: 'Aprender',
    targetDate: null,
    status: 'draft',
    activeVersion: null,
    sourceIds: [],
    settings: null,
  })
  const version = await repos.paths.createVersion({
    pathId: path.id,
    spec: draftOf(options.knownNodeIds) as unknown as JsonObject,
    knowledgeGraph: GRAPH as unknown as JsonObject,
    manifest: null,
    diff: null,
    frozenAt: null,
  })
  const { tree } = await freezePath({ repos, clock }, { pathVersionId: version.id })
  const moduleIds: Record<string, string> = {}
  const sectionIds: Record<string, string> = {}
  const lessonIds: Record<string, string[]> = {}
  const itemModule = new Map<string, string>()
  for (const section of tree.sections) {
    sectionIds[section.specId] = section.id
    for (const module of section.modules) {
      moduleIds[module.specId] = module.id
      lessonIds[module.specId] = module.lessons.map((lesson) => lesson.id)
      const concepts = draftOf()
        .sections.flatMap((s) => s.modules)
        .find((m) => m.id === module.specId)?.concept_ids as string[]
      for (const [index, concept] of concepts.entries()) {
        const difficulty = index === 0 ? 2 : 4
        const row = toActivityRow(itemDraft(concept, difficulty), {
          bloom: index === 0 ? 'understand' : 'apply',
          misconceptionIds: ['X001'],
          status: 'ready',
        })
        const activity = await repos.paths.createActivity({ ...row, lessonId: null, ordinal: null })
        const entry = await repos.itemBank.create({
          activityId: activity.id,
          pathVersionId: version.id,
          moduleId: module.id,
          usage: ['diagnostic'],
          difficultyLogit: difficultyLogitOf(difficulty),
          discriminationHint: null,
          exposure: 0,
          stats: { n: 0, p_correct: null },
          authoring: {
            cell_key: `${module.specId}|diagnostic|${index}`,
            misconception_by_option: { b: 'X001', c: 'X001', d: 'X001' },
          },
        })
        itemModule.set(entry.id, module.specId)
      }
    }
  }
  return { opened, repos, pathVersionId: version.id, moduleIds, sectionIds, lessonIds, itemModule }
}

/** One flashcard in the module's core lesson: a New card, never reviewed. */
async function flashcard(
  w: World,
  moduleSpecId: string,
): Promise<{ itemId: string; cardId: string }> {
  const lessonId = (w.lessonIds[moduleSpecId] as string[])[0] as string
  const item = await w.repos.knowledgeItems.create({
    lessonId,
    topicId: null,
    kind: 'fact',
    fields: { front: 'q', back: 'a' },
    sourceId: null,
    annotationId: null,
    locator: null,
    asOf: null,
    importance: 'normal',
    status: 'need_to_learn',
    createdBy: 'ai',
    tags: [],
  })
  const card = await w.repos.cards.create({
    itemId: item.id,
    template: 'basic',
    payload: null,
    due: clock.now(),
    stability: 0,
    difficulty: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: CARD_STATE.New,
    lastReview: null,
    suspended: false,
    buriedUntil: null,
    leech: false,
    importanceOverride: null,
    importanceOverrideExpiresAt: null,
    examId: null,
  })
  return { itemId: item.id, cardId: card.id }
}

async function drive(
  service: DiagnosticService,
  state: DiagnosticStateDto,
  choose: (itemBankId: string) => string = () => 'a',
  onServe: (itemBankId: string) => void = () => {},
): Promise<DiagnosticStateDto> {
  let current = state
  let guard = 0
  while (current.item !== null) {
    guard += 1
    if (guard > 31) throw new Error('the diagnostic never stopped')
    onServe(current.item.itemBankId)
    current = await service.answer({
      sessionId: current.session.id,
      attemptId: current.item.attemptId,
      skipped: false,
      response: { sets: [{ selected: [choose(current.item.itemBankId)] }] },
      confidence: 'sure',
      timeMs: 15_000,
    })
  }
  return current
}

describe('gradeChoiceResponse', () => {
  const activity = {
    config: {
      payload: {
        sets: [
          {
            options: [
              { id: 'a', correct: true },
              { id: 'b', correct: false },
            ],
          },
        ],
      },
    },
  }

  it('is correct only when exactly the keyed option is selected', () => {
    expect(gradeChoiceResponse(activity, { sets: [{ selected: ['a'] }] })).toEqual({
      correct: true,
      chosenOptionId: 'a',
    })
    expect(gradeChoiceResponse(activity, { sets: [{ selected: ['b'] }] }).correct).toBe(false)
    expect(gradeChoiceResponse(activity, { sets: [{ selected: ['a', 'b'] }] }).correct).toBe(false)
    expect(gradeChoiceResponse(activity, { sets: [{ selected: [] }] }).correct).toBe(false)
  })

  it('treats a malformed response as wrong rather than trusting it', () => {
    expect(gradeChoiceResponse(activity, 'a')).toEqual({ correct: false, chosenOptionId: null })
    expect(gradeChoiceResponse(activity, { sets: 'a' }).correct).toBe(false)
    expect(gradeChoiceResponse({ config: {} }, { sets: [{ selected: ['a'] }] }).correct).toBe(false)
  })
})

describe('createDiagnosticService', () => {
  let w: World
  let memory: MemoryService
  let service: DiagnosticService

  beforeEach(async () => {
    now = new Date('2026-09-11T12:00:00.000Z')
    w = await world()
    memory = await createMemoryService({ repos: w.repos })
    service = createDiagnosticService({ repos: w.repos, memory, clock })
  })

  afterEach(() => w.opened.close())

  const everySection = (level: 'never' | 'familiar' | 'know' | 'master') =>
    Object.fromEntries(Object.values(w.sectionIds).map((id) => [id, level]))

  it('"desde cero" finishes at once: everything unknown, nothing asked, nothing written', async () => {
    const state = await service.start({
      pathVersionId: w.pathVersionId,
      entry: 'scratch',
      selfAssessment: {},
    })

    expect(state.session.status).toBe('completed')
    expect(state.session.stopReason).toBe('from_scratch')
    expect(state.item).toBeNull()
    expect(state.result?.modules.every((module) => module.status === 'unknown')).toBe(true)
    for (const lessonId of Object.values(w.lessonIds).flat()) {
      expect((await w.repos.paths.findLesson(lessonId))?.completedAt).toBeNull()
    }
  })

  it('refuses "ya sé parte" while the bank has no diagnostic items', async () => {
    for (const entry of await w.repos.itemBank.listByPathVersion(w.pathVersionId)) {
      await w.repos.itemBank.softDelete(entry.id)
    }
    await expect(
      service.start({ pathVersionId: w.pathVersionId, entry: 'partial', selfAssessment: {} }),
    ).rejects.toThrow(/no diagnostic items/)
  })

  it('serves an item on an open diagnostic attempt and bumps its exposure', async () => {
    const state = await service.start({
      pathVersionId: w.pathVersionId,
      entry: 'partial',
      selfAssessment: everySection('know'),
    })

    const item = state.item
    expect(item).not.toBeNull()
    const attempt = await w.repos.attempts.findById(item?.attemptId as string)
    expect(attempt).toMatchObject({ context: 'diagnostic', mode: 'test', finishedAt: null })
    expect((await w.repos.itemBank.findById(item?.itemBankId as string))?.exposure).toBe(1)
    expect(state.progress.remaining).toBeGreaterThan(0)

    // A second start resumes the same session instead of opening another.
    const again = await service.start({
      pathVersionId: w.pathVersionId,
      entry: 'partial',
      selfAssessment: everySection('know'),
    })
    expect(again.session.id).toBe(state.session.id)
    expect(again.item?.attemptId).toBe(item?.attemptId)
  })

  it('never serves a section self-assessed "nunca lo vi", and never more than 30 items', async () => {
    const served: string[] = []
    const state = await drive(
      service,
      await service.start({
        pathVersionId: w.pathVersionId,
        entry: 'partial',
        selfAssessment: { ...everySection('know'), [w.sectionIds.S02 as string]: 'never' },
      }),
      () => 'a',
      (id) => served.push(w.itemModule.get(id) as string),
    )

    expect(served.length).toBeGreaterThan(0)
    expect(served).not.toContain('M03')
    expect(state.progress.asked).toBeLessThanOrEqual(30)
    const m03 = state.result?.modules.find((module) => module.specId === 'M03')
    expect(m03).toMatchObject({ status: 'unknown', source: 'never_seen' })
  })

  it('grades from the response, moves the item’s Elo and records a confident misconception', async () => {
    const first = await service.start({
      pathVersionId: w.pathVersionId,
      entry: 'partial',
      selfAssessment: everySection('know'),
    })
    const itemId = first.item?.itemBankId as string
    const before = await w.repos.itemBank.findById(itemId)

    const next = await service.answer({
      sessionId: first.session.id,
      attemptId: first.item?.attemptId as string,
      skipped: false,
      response: { sets: [{ selected: ['b'] }] },
      confidence: 'sure',
      timeMs: 12_000,
    })

    const attempt = await w.repos.attempts.findById(first.item?.attemptId as string)
    expect(attempt).toMatchObject({ correct: false, confidence: 'sure', timeMs: 12_000 })
    expect(attempt?.finishedAt).not.toBeNull()
    const after = await w.repos.itemBank.findById(itemId)
    expect(after?.stats).toMatchObject({ n: 1, p_correct: 0 })
    // Answered worse than expected: the item is harder than its prior said.
    expect(after?.difficultyLogit).toBeGreaterThan(before?.difficultyLogit as number)
    expect(next.progress.asked).toBe(1)

    const done = await drive(service, next)
    expect(done.result?.remediations).toContainEqual(
      expect.objectContaining({ misconceptionId: 'X001' }),
    )
  })

  it('leaves the item’s Elo alone on a skip', async () => {
    const first = await service.start({
      pathVersionId: w.pathVersionId,
      entry: 'partial',
      selfAssessment: everySection('know'),
    })
    const itemId = first.item?.itemBankId as string
    await service.answer({
      sessionId: first.session.id,
      attemptId: first.item?.attemptId as string,
      skipped: true,
      confidence: null,
      timeMs: 3_000,
    })
    expect((await w.repos.itemBank.findById(itemId))?.stats).toEqual({ n: 0, p_correct: null })
  })

  it('rejects an answer to an item that is no longer on screen', async () => {
    const first = await service.start({
      pathVersionId: w.pathVersionId,
      entry: 'partial',
      selfAssessment: everySection('know'),
    })
    await expect(
      service.answer({
        sessionId: first.session.id,
        attemptId: '00000000-0000-7000-8000-000000000000',
        skipped: false,
        response: { sets: [{ selected: ['a'] }] },
        confidence: 'sure',
        timeMs: 1_000,
      }),
    ).rejects.toThrow(/no longer the one on screen/)
  })

  it('resumes by replay after a restart, on the same item', async () => {
    const first = await service.start({
      pathVersionId: w.pathVersionId,
      entry: 'partial',
      selfAssessment: everySection('know'),
    })
    const second = await service.answer({
      sessionId: first.session.id,
      attemptId: first.item?.attemptId as string,
      skipped: false,
      response: { sets: [{ selected: ['a'] }] },
      confidence: 'unsure',
      timeMs: 10_000,
    })

    const restarted = createDiagnosticService({ repos: w.repos, memory, clock })
    const resumed = await restarted.get(w.pathVersionId)

    expect(resumed.state?.session.id).toBe(first.session.id)
    expect(resumed.state?.item?.attemptId).toBe(second.item?.attemptId)
    expect(resumed.state?.progress).toEqual(second.progress)
  })

  it('seeds a known module’s cards with exactly one "diagnostic" log each, in Review', async () => {
    const { cardId } = await flashcard(w, 'M01')
    const done = await drive(
      service,
      await service.start({
        pathVersionId: w.pathVersionId,
        entry: 'partial',
        selfAssessment: everySection('master'),
      }),
    )

    const m01 = done.result?.modules.find((module) => module.specId === 'M01')
    expect(m01?.status).toBe('known')
    expect(m01?.seededCards).toBe(1)
    // Every lesson row of the module is completed, its reinforcement node included, but the
    // summary counts the one core lesson the learner sees — as the completion screen does.
    expect((w.lessonIds.M01 as string[]).length).toBeGreaterThan(1)
    expect(m01?.lessonsCompleted).toBe(1)
    for (const lessonId of w.lessonIds.M01 as string[]) {
      expect((await w.repos.paths.findLesson(lessonId))?.completedAt).not.toBeNull()
    }
    const logs = await w.repos.reviewLogs.listByCard(cardId)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ context: 'diagnostic', rating: 3 })
    expect((await w.repos.cards.findById(cardId))?.state).toBe(CARD_STATE.Review)

    // The later sweeps never seed twice.
    await service.sweepPendingSeeds()
    await service.onLessonExpanded(w.pathVersionId, (w.lessonIds.M01 as string[])[0] as string)
    expect(await w.repos.reviewLogs.listByCard(cardId)).toHaveLength(1)
  })

  it('seeds a known module’s cards when its lesson is written after the diagnostic', async () => {
    const done = await drive(
      service,
      await service.start({
        pathVersionId: w.pathVersionId,
        entry: 'partial',
        selfAssessment: everySection('master'),
      }),
    )
    const m01 = done.result?.modules.find((module) => module.specId === 'M01')
    expect(m01?.status).toBe('known')
    expect(m01?.pendingSeedLessons).toBe(1)

    const { cardId } = await flashcard(w, 'M01')
    await service.onLessonExpanded(w.pathVersionId, (w.lessonIds.M01 as string[])[0] as string)

    const logs = await w.repos.reviewLogs.listByCard(cardId)
    expect(logs).toHaveLength(1)
    expect(logs[0]?.context).toBe('diagnostic')
  })

  it('takes the seeding and the completion back with one click, once', async () => {
    const { cardId } = await flashcard(w, 'M01')
    const done = await drive(
      service,
      await service.start({
        pathVersionId: w.pathVersionId,
        entry: 'partial',
        selfAssessment: everySection('master'),
      }),
    )

    const reverted = await service.revert(done.session.id, w.moduleIds.M01)

    expect(reverted.result?.modules.find((m) => m.specId === 'M01')?.reverted).toBe(true)
    expect(await w.repos.reviewLogs.listByCard(cardId)).toHaveLength(0)
    expect((await w.repos.cards.findById(cardId))?.state).toBe(CARD_STATE.New)
    for (const lessonId of w.lessonIds.M01 as string[]) {
      expect((await w.repos.paths.findLesson(lessonId))?.completedAt).toBeNull()
    }
    const again = await service.revert(done.session.id, w.moduleIds.M01)
    expect(again.result?.modules.find((m) => m.specId === 'M01')?.reverted).toBe(true)
  })

  it('"Terminar ahora" stops as abandoned and closes the attempt on screen', async () => {
    const first = await service.start({
      pathVersionId: w.pathVersionId,
      entry: 'partial',
      selfAssessment: everySection('know'),
    })
    const finished = await service.finish(first.session.id)

    expect(finished.session.stopReason).toBe('abandoned')
    expect(finished.item).toBeNull()
    const attempt = await w.repos.attempts.findById(first.item?.attemptId as string)
    expect(attempt?.finishedAt).not.toBeNull()
  })

  it('re-opens a known module after two lapses in fourteen days', async () => {
    const { cardId } = await flashcard(w, 'M01')
    const done = await drive(
      service,
      await service.start({
        pathVersionId: w.pathVersionId,
        entry: 'partial',
        selfAssessment: everySection('master'),
      }),
    )
    expect(done.result?.modules.find((m) => m.specId === 'M01')?.status).toBe('known')

    // Two Agains on the card while it was in Review, three days and one day ago.
    for (const daysAgo of [3, 1]) {
      await w.repos.reviewLogs.append({
        cardId,
        rating: 1,
        state: CARD_STATE.Review,
        due: now,
        stability: 5,
        difficulty: 5,
        elapsedDays: 5,
        scheduledDays: 5,
        learningSteps: 0,
        review: new Date(now.getTime() - daysAgo * 86_400_000),
        durationMs: 4_000,
        context: 'daily',
        exerciseScore: null,
        device: null,
        attemptId: null,
        activityType: null,
        algorithmVersion: 'fsrs6',
      })
    }
    // R is healthy: the lapses alone are the reason.
    const verifier = createDiagnosticService({
      repos: w.repos,
      memory: { ...memory, retrievability: () => 0.95 },
      clock,
    })
    expect(await verifier.verifyKnownModules()).toEqual({ reopened: 1 })

    for (const lessonId of w.lessonIds.M01 as string[]) {
      expect((await w.repos.paths.findLesson(lessonId))?.completedAt).toBeNull()
    }
    const reopened = (await verifier.get(w.pathVersionId)).state?.result?.modules.find(
      (m) => m.specId === 'M01',
    )
    expect(reopened).toMatchObject({ reopened: true, reopenReason: 'lapses' })
  })

  it('re-opens a known module whose cards fall under a mean R of 0.7', async () => {
    const { itemId } = await flashcard(w, 'M01')
    const done = await drive(
      service,
      await service.start({
        pathVersionId: w.pathVersionId,
        entry: 'partial',
        selfAssessment: everySection('master'),
      }),
    )
    expect(done.result?.modules.find((m) => m.specId === 'M01')?.status).toBe('known')

    const healthy = createDiagnosticService({
      repos: w.repos,
      memory: { ...memory, retrievability: () => 0.95 },
      clock,
    })
    expect(await healthy.verifyKnownModules()).toEqual({ reopened: 0 })

    const forgetting: DiagnosticMemory = { ...memory, retrievability: () => 0.5 }
    const verifier = createDiagnosticService({ repos: w.repos, memory: forgetting, clock })
    expect(await verifier.verifyKnownModules()).toEqual({ reopened: 1 })

    for (const lessonId of w.lessonIds.M01 as string[]) {
      expect((await w.repos.paths.findLesson(lessonId))?.completedAt).toBeNull()
    }
    expect((await w.repos.knowledgeItems.findById(itemId))?.importance).toBe('normal')
    const reopened = (await verifier.get(w.pathVersionId)).state?.result?.modules.find(
      (m) => m.specId === 'M01',
    )
    expect(reopened).toMatchObject({ reopened: true, reopenReason: 'low_retention' })
    // Idempotent: a reopened module is not reopened again.
    expect(await verifier.verifyKnownModules()).toEqual({ reopened: 0 })
  })
})

describe('the preview’s "ya lo sé"', () => {
  it('is seeded like a known module and never asked by the diagnostic', async () => {
    const w = await world({ knownNodeIds: ['M01'] })
    try {
      const memory = await createMemoryService({ repos: w.repos })
      const service = createDiagnosticService({ repos: w.repos, memory, clock })
      const { cardId } = await flashcard(w, 'M01')

      await service.recordPreviewKnown(w.pathVersionId)
      await service.recordPreviewKnown(w.pathVersionId)

      const sessions = await w.repos.diagnosticSessions.listByPathVersion(w.pathVersionId)
      expect(sessions.filter((session) => session.entry === 'preview')).toHaveLength(1)
      const logs = await w.repos.reviewLogs.listByCard(cardId)
      expect(logs).toHaveLength(1)
      expect(logs[0]?.context).toBe('diagnostic')

      const served: string[] = []
      const sections = Object.fromEntries(Object.values(w.sectionIds).map((id) => [id, 'know']))
      const done = await drive(
        service,
        await service.start({
          pathVersionId: w.pathVersionId,
          entry: 'partial',
          selfAssessment: sections as Record<string, 'know'>,
        }),
        () => 'a',
        (id) => served.push(w.itemModule.get(id) as string),
      )
      expect(served).not.toContain('M01')
      expect(done.result?.modules.find((m) => m.specId === 'M01')?.source).toBe('self_declared')

      // "Deshacer" on that module from the diagnostic's own summary reaches the preview's
      // seeding: the log goes, and the summary shows the module undone.
      const undone = await service.revert(done.session.id, w.moduleIds.M01)
      expect(undone.result?.modules.find((m) => m.specId === 'M01')?.reverted).toBe(true)
      expect(await w.repos.reviewLogs.listByCard(cardId)).toHaveLength(0)
      for (const lessonId of w.lessonIds.M01 as string[]) {
        expect((await w.repos.paths.findLesson(lessonId))?.completedAt).toBeNull()
      }
    } finally {
      w.opened.close()
    }
  })
})
