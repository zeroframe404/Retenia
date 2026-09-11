import type {
  Activity,
  Attempt,
  Card,
  Chunk,
  Clock,
  EntityPatch,
  ItemBankEntry,
  ItemUsage,
  KnowledgeItem,
  LearningPath,
  Lesson,
  Module,
  NewEntity,
  PathTree,
  PathVersion,
  Remediation,
  RemediationAuthorCollected,
  RemediationAuthorRequest,
  RemediationStatus,
  ReviewLog,
  Section,
} from '@retenia/core'
import { CARD_STATE, createUuidV7Generator } from '@retenia/core'
import type { RemediationAuthor, RemediationAuthorCall } from '../remediation/author'
import type { RemediationRepos, RemediationUnitOfWork } from '../remediation/service'
import type { KnowledgeGraphDocument } from '../schemas/knowledge-graph'
import type { PathDraft } from '../schemas/path-draft'

/**
 * A frozen, active path version with one section, two modules (M01: c1/c2, M02: c3/c4) and
 * four core lessons (L01..L04, two per module), for `remediation/service.test.ts` — the
 * smallest tree `placeRemediation` can anchor on and `checkLimits` can count against.
 *
 * In-memory `RemediationUnitOfWork`, a scriptable `RemediationAuthor` (P11's transport) and a
 * fake `ai.structured`, the way `item-bank-world.ts` fakes P9's author and `expand-repos.ts`
 * fakes a stage's repositories: `transaction()` just calls the work with the same repos, and
 * every mutation stamps the audit set from the controllable clock.
 */

export interface RemediationWorldRows {
  readonly paths: LearningPath[]
  readonly versions: PathVersion[]
  readonly sections: Section[]
  readonly modules: Module[]
  readonly lessons: Lesson[]
  readonly activities: Activity[]
  readonly chunks: Chunk[]
  readonly itemBank: ItemBankEntry[]
  readonly knowledgeItems: KnowledgeItem[]
  readonly cards: Card[]
  readonly reviewLogs: ReviewLog[]
  readonly attempts: Attempt[]
  readonly remediations: Remediation[]
}

export interface ControllableClock extends Clock {
  set(date: Date): void
  advance(ms: number): void
}

export function controllableClock(start: Date): ControllableClock {
  let current = start
  return {
    now: () => current,
    set: (date) => {
      current = date
    },
    advance: (ms) => {
      current = new Date(current.getTime() + ms)
    },
  }
}

/** One P11 answer, scriptable per `specId` — defaults to a small explanation citing `B01`, one
 *  worked example, `itemsWanted` generated items and a contrast card. */
export interface AuthorScript {
  readonly blocks?: RemediationAuthorCollected['blocks']
  readonly items?: RemediationAuthorCollected['items']
  readonly contrastCard?: RemediationAuthorCollected['contrastCard']
  readonly title?: string | null
  readonly rejected?: RemediationAuthorCollected['rejected']
  readonly notes?: readonly string[]
}

export interface FakeRemediationAuthor extends RemediationAuthor {
  /** Script the next `collect()` for a given `specId`, or the default for every other one. */
  script(specId: string, script: AuthorScript | null): void
}

function defaultCollected(request: RemediationAuthorRequest): RemediationAuthorCollected {
  const items: RemediationAuthorCollected['items'] = Array.from(
    { length: request.itemsWanted },
    (_, index) => ({
      key: `${request.specId}#gen#${index}`,
      row: {
        type: 'mcq_single',
        family: 'choice',
        schemaVersion: 1,
        lang: request.lang,
        bloom: 'understand',
        difficulty: 2,
        conceptIds: [request.concept.id],
        misconceptionIds: [],
        config: { prompt: `${request.concept.name} — ítem generado ${index}` },
        grading: { method: 'det' },
        status: 'ready',
        sourceRefs: [],
      },
      form: null,
      difficulty: 2,
      conceptIds: [request.concept.id],
      misconceptionByOption: {},
      stem: `${request.concept.name} — ítem generado ${index}`,
    }),
  )
  return {
    title: `Repaso: ${request.concept.name}`,
    blocks: [
      {
        type: 'explanation',
        content: `Repasemos ${request.concept.name}. [cite:B01]`,
        citations: ['B01'],
      },
      {
        type: 'worked_example',
        content: `Ejemplo resuelto de ${request.concept.name}. [cite:B01]`,
        citations: ['B01'],
      },
    ],
    items,
    contrastCard: {
      front: `¿Qué es ${request.concept.name}?`,
      back: request.concept.definition,
      citations: ['B01'],
    },
    rejected: [],
    notes: [],
  }
}

/** A fake `RemediationAuthor`: `plan()` mints one call keyed by `specId`, `collect()` answers
 *  from a per-`specId` script or `defaultCollected`. The fake `ai.structured` below never has
 *  its value read, the way `build.test.ts`'s fake author never reads `value` either. */
export function fakeRemediationAuthor(): FakeRemediationAuthor {
  const scripts = new Map<string, AuthorScript>()
  const requestBySpecId = new Map<string, RemediationAuthorRequest>()
  return {
    script: (specId, script) => {
      if (script === null) scripts.delete(specId)
      else scripts.set(specId, script)
    },
    plan: (request) => {
      requestBySpecId.set(request.specId, request)
      const call: RemediationAuthorCall = {
        customId: request.specId,
        structured: {
          prompt: `remediation:${request.specId}`,
          temperature: 0.7,
          schema: undefined as never,
          schemaName: 'p11_remediation',
          idempotencyKey: request.specId,
        } as never,
        batch: {
          customId: request.specId,
          request: { prompt: `remediation:${request.specId}`, temperature: 0.7 },
        },
        injectionSuspected: false,
        conceptIds: [request.concept.id],
        misconceptionIds: request.misconception === null ? [] : [request.misconception.id],
        misconceptionsAvailable: request.misconception !== null,
        itemsWanted: request.itemsWanted,
      }
      return call
    },
    collect: (call) => {
      const request = requestBySpecId.get(call.customId)
      const script = scripts.get(call.customId)
      if (script !== undefined) {
        return {
          title: script.title ?? null,
          blocks: script.blocks ?? [],
          items: script.items ?? [],
          contrastCard: script.contrastCard ?? null,
          rejected: script.rejected ?? [],
          notes: script.notes ?? [],
        }
      }
      if (request === undefined) {
        return { title: null, blocks: [], items: [], contrastCard: null, rejected: [], notes: [] }
      }
      return defaultCollected(request)
    },
  }
}

export interface FakeAiOptions {
  /** `specId`s (the wave's `customId`) whose call throws — simulates a P11 call failure. */
  readonly failSpecIds?: ReadonlySet<string>
}

/** A fake `ai.structured`: the fake author never reads its resolved value, so it is arbitrary
 *  except for the `failSpecIds` it is told to throw on. */
export function fakeRemediationAi(options: FakeAiOptions = {}): { structured: () => unknown } {
  return {
    structured: () => async (request: { prompt?: string }) => {
      const prompt = request.prompt ?? ''
      const failing = [...(options.failSpecIds ?? [])].some(
        (specId) => prompt === `remediation:${specId}`,
      )
      if (failing) throw new Error('the model is unreachable')
      return {
        value: { ok: true },
        model: 'fake-model',
        usage: { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, usd: 0.001 },
        repairs: 0,
      }
    },
  }
}

export interface RemediationWorldOptions {
  readonly now?: Date
}

export interface RemediationWorld {
  readonly rows: RemediationWorldRows
  readonly repos: RemediationUnitOfWork & { rows: RemediationWorldRows }
  readonly clock: ControllableClock
  readonly ids: { next(): string }
  readonly pathId: string
  readonly pathVersionId: string
  readonly sectionId: string
  readonly moduleIds: { readonly M01: string; readonly M02: string }
  readonly lessonIds: {
    readonly L01: string
    readonly L02: string
    readonly L03: string
    readonly L04: string
  }
  readonly concepts: readonly ['c1', 'c2', 'c3', 'c4']
  readonly draft: PathDraft
  readonly graph: KnowledgeGraphDocument
  /** The one knowledge item seeded for a concept. */
  itemOf(conceptId: string): KnowledgeItem
  /** The cards seeded for a concept's item (two by default: `${conceptId}-card-1/2`). */
  cardsOf(conceptId: string): Card[]
  author: FakeRemediationAuthor
  ai: { structured: () => unknown }
}

const AUDIT = (clock: Clock) => ({
  createdAt: clock.now(),
  updatedAt: clock.now(),
  deletedAt: null,
  deviceId: 'test',
  version: 1,
})

export function remediationWorld(options: RemediationWorldOptions = {}): RemediationWorld {
  const clock = controllableClock(options.now ?? new Date('2026-01-05T09:00:00.000Z'))
  const ids = createUuidV7Generator(clock)
  const now = clock.now()
  const audit = { createdAt: now, updatedAt: now, deletedAt: null, deviceId: 'test', version: 1 }

  const pathId = ids.next()
  const versionId = ids.next()
  const sectionId = ids.next()
  const module1Id = ids.next()
  const module2Id = ids.next()
  const lesson1Id = ids.next()
  const lesson2Id = ids.next()
  const lesson3Id = ids.next()
  const lesson4Id = ids.next()

  const concepts = ['c1', 'c2', 'c3', 'c4'] as const

  const chunkOf = (conceptId: string): Chunk => ({
    id: `chunk-${conceptId}`,
    sourceId: 'src-book',
    unitId: null,
    ordinal: 0,
    text: `Texto fuente sobre ${conceptId}, con el detalle que sostiene la explicación.`,
    charStart: 0,
    charEnd: 80,
    tokenCount: 20,
    hash: `hash-${conceptId}`,
    headingPath: `Libro > ${conceptId}`,
    context: null,
    chunkKey: `key-${conceptId}`,
    chunkingVersion: null,
    isFrontmatter: false,
    locator: { page: 1, block_ids: [`${conceptId}-b1`] },
    ...audit,
  })
  const chunks = concepts.map(chunkOf)

  const conceptNode = (conceptId: string, title: string) => ({
    concept_id: conceptId,
    canonical: title,
    aliases: [],
    definition: `Definición de ${title}.`,
    kind: 'concept' as const,
    bloom_target: 'understand' as const,
    difficulty: 2,
    importance: 0.8,
    source_refs: [
      {
        source_id: 'src-book',
        chunk_id: `chunk-${conceptId}`,
        chunk_key: `key-${conceptId}`,
        block_ids: [`${conceptId}-b1`],
        heading_path: `Libro > ${conceptId}`,
        ordinal: 0,
      },
    ],
  })

  const graph: KnowledgeGraphDocument = {
    version: 1,
    embedding_model_id: null,
    threshold: 0.86,
    nodes: [
      conceptNode('c1', 'Concepto 1'),
      conceptNode('c2', 'Concepto 2'),
      conceptNode('c3', 'Concepto 3'),
      conceptNode('c4', 'Concepto 4'),
    ],
    edges: [],
  }

  const draftLesson = (id: string, conceptId: string) => ({
    id,
    kind: 'core' as const,
    title: `Lección ${id}`,
    concept_ids: [conceptId],
    warmup_concept_ids: [],
    objectives: [{ text: `Explicar ${conceptId}`, bloom: 'understand' as const }],
    prerequisite_lesson_ids: [],
    estimated_minutes: 10,
    source_refs: [],
    origin: 'model' as const,
  })

  const draft: PathDraft = {
    version: 1,
    kind: 'draft',
    title: 'Curso de remediación',
    language: 'es-AR',
    target_language: null,
    level: 'beginner',
    goal: 'Aprender los cuatro conceptos',
    target_date: null,
    sources: [{ source_id: 'src-book', title: 'Libro', primary: true }],
    sections: [
      {
        id: 'S01',
        title: 'Sección 1',
        modules: [
          {
            id: 'M01',
            title: 'Módulo 1',
            objectives: [{ text: 'Explicar los conceptos 1 y 2', bloom: 'understand' }],
            concept_ids: ['c1', 'c2'],
            lessons: [draftLesson('L01', 'c1'), draftLesson('L02', 'c2')],
            reinforcement: {
              id: 'M01.reinf',
              kind: 'reinforcement',
              module_id: 'M01',
              concept_ids: ['c1', 'c2'],
              earlier_concept_ids: [],
              item_count: 6,
              estimated_minutes: 8,
            },
            checkpoint: null,
            estimated_minutes: 20,
          },
          {
            id: 'M02',
            title: 'Módulo 2',
            objectives: [{ text: 'Explicar los conceptos 3 y 4', bloom: 'understand' }],
            concept_ids: ['c3', 'c4'],
            lessons: [draftLesson('L03', 'c3'), draftLesson('L04', 'c4')],
            reinforcement: {
              id: 'M02.reinf',
              kind: 'reinforcement',
              module_id: 'M02',
              concept_ids: ['c3', 'c4'],
              earlier_concept_ids: ['c1', 'c2'],
              item_count: 6,
              estimated_minutes: 8,
            },
            checkpoint: null,
            estimated_minutes: 20,
          },
        ],
      },
    ],
    final_exam: {
      id: 'FINAL',
      kind: 'final_exam',
      blueprint: {
        topics: [
          { module_id: 'M01', weight: 1 },
          { module_id: 'M02', weight: 1 },
        ],
        item_count: 8,
      },
      estimated_minutes: 30,
    },
    misconceptions: [
      { id: 'X001', concept_id: 'c1', text: 'Se cree que…', why_wrong: 'No es así.' },
    ],
    excluded: [],
    stats: {
      sections: 1,
      modules: 2,
      lessons: 4,
      checkpoints: 0,
      concepts: 4,
      minutes: 40,
      weeks_estimate: 1,
    },
    warnings: [],
    known_node_ids: [],
    qa_mode: 'full',
  }

  const path: LearningPath = {
    id: pathId,
    title: draft.title,
    language: draft.language,
    level: draft.level,
    goal: draft.goal,
    targetDate: null,
    status: 'active',
    activeVersion: 1,
    sourceIds: ['src-book'],
    settings: null,
    ...audit,
  }

  const version: PathVersion = {
    id: versionId,
    pathId,
    number: 1,
    spec: draft as never,
    knowledgeGraph: graph as never,
    manifest: null,
    diff: null,
    frozenAt: now,
    ...audit,
  }

  const section: Section = {
    id: sectionId,
    pathVersionId: versionId,
    ordinal: 0,
    specId: 'S01',
    title: 'Sección 1',
    unlockRule: null,
    xpReward: 0,
    ...audit,
  }

  const module1: Module = {
    id: module1Id,
    sectionId,
    ordinal: 0,
    specId: 'M01',
    title: 'Módulo 1',
    objectives: [],
    diagnosticItemIds: [],
    unlockRule: null,
    xpReward: 0,
    ...audit,
  }
  const module2: Module = {
    ...module1,
    id: module2Id,
    ordinal: 1,
    specId: 'M02',
    title: 'Módulo 2',
  }

  const coreLesson = (
    id: string,
    moduleId: string,
    ordinal: number,
    specId: string,
    conceptId: string,
  ): Lesson => ({
    id,
    moduleId,
    ordinal,
    specId,
    kind: 'core',
    parentLessonId: null,
    title: `Lección ${specId}`,
    status: 'ready',
    objectives: [],
    conceptIds: [conceptId],
    prerequisiteLessonIds: [],
    estimatedMinutes: 10,
    theory: null,
    citations: [],
    qa: null,
    expansion: null,
    remediation: null,
    unlockRule: null,
    xpReward: 0,
    completedAt: null,
    ...audit,
  })

  const lesson1 = coreLesson(lesson1Id, module1Id, 0, 'L01', 'c1')
  const lesson2 = coreLesson(lesson2Id, module1Id, 1, 'L02', 'c2')
  const lesson3 = coreLesson(lesson3Id, module2Id, 0, 'L03', 'c3')
  const lesson4 = coreLesson(lesson4Id, module2Id, 1, 'L04', 'c4')

  const knowledgeItemOf = (conceptId: string, lessonId: string): KnowledgeItem => ({
    id: ids.next(),
    lessonId,
    topicId: conceptId,
    kind: 'concept',
    fields: { type: 'basic', front: `¿Qué es ${conceptId}?`, back: conceptId },
    sourceId: 'src-book',
    annotationId: null,
    locator: null,
    asOf: null,
    importance: 'normal',
    status: 'active',
    createdBy: 'ai',
    tags: [],
    ...audit,
  })

  const cardOf = (itemId: string, suffix: string): Card => ({
    itemId,
    template: 'basic',
    payload: null,
    due: now,
    stability: 1,
    difficulty: 1,
    scheduledDays: 1,
    learningSteps: 0,
    reps: 1,
    lapses: 0,
    state: CARD_STATE.Review,
    lastReview: now,
    suspended: false,
    buriedUntil: null,
    leech: false,
    importanceOverride: null,
    importanceOverrideExpiresAt: null,
    examId: null,
    ...audit,
    id: `${itemId}-${suffix}`,
  })

  const items: KnowledgeItem[] = [
    knowledgeItemOf('c1', lesson1Id),
    knowledgeItemOf('c2', lesson2Id),
    knowledgeItemOf('c3', lesson3Id),
    knowledgeItemOf('c4', lesson4Id),
  ]
  const cards: Card[] = items.flatMap((item) => [
    cardOf(item.id, 'card-1'),
    cardOf(item.id, 'card-2'),
  ])

  const rows: RemediationWorldRows = {
    paths: [path],
    versions: [version],
    sections: [section],
    modules: [module1, module2],
    lessons: [lesson1, lesson2, lesson3, lesson4],
    activities: [],
    chunks,
    itemBank: [],
    knowledgeItems: items,
    cards,
    reviewLogs: [],
    attempts: [],
    remediations: [],
  }

  const live = <T extends { deletedAt: Date | null }>(list: readonly T[]): T[] =>
    list.filter((row) => row.deletedAt === null)

  const auditNew = <T extends object>(input: T & { id?: string }) => ({
    ...(input as T),
    id: input.id ?? ids.next(),
    ...AUDIT(clock),
  })

  const paths: RemediationRepos['paths'] = {
    findById: async (id) => rows.paths.find((row) => row.id === id),
    findVersion: async (id) => rows.versions.find((row) => row.id === id),
    findVersionByNumber: async (pathId, number) =>
      rows.versions.find((row) => row.pathId === pathId && row.number === number),
    loadTree: async (versionIdArg): Promise<PathTree | undefined> => {
      const foundVersion = rows.versions.find((row) => row.id === versionIdArg)
      if (foundVersion === undefined) return undefined
      const foundPath = rows.paths.find((row) => row.id === foundVersion.pathId)
      if (foundPath === undefined) return undefined
      return {
        path: foundPath,
        version: foundVersion,
        sections: live(rows.sections)
          .filter((s) => s.pathVersionId === versionIdArg)
          .toSorted((a, b) => a.ordinal - b.ordinal)
          .map((s) => ({
            ...s,
            modules: live(rows.modules)
              .filter((m) => m.sectionId === s.id)
              .toSorted((a, b) => a.ordinal - b.ordinal)
              .map((m) => ({
                ...m,
                lessons: live(rows.lessons)
                  .filter((l) => l.moduleId === m.id)
                  .toSorted((a, b) => a.ordinal - b.ordinal)
                  .map((l) => ({
                    ...l,
                    activities: live(rows.activities).filter((a) => a.lessonId === l.id),
                  })),
              })),
          })),
      }
    },
    findLesson: async (id) => rows.lessons.find((row) => row.id === id),
    findModule: async (id) => rows.modules.find((row) => row.id === id),
    findSection: async (id) => rows.sections.find((row) => row.id === id),
    createLesson: async (input: NewEntity<Lesson>) => {
      const created = auditNew(input) as Lesson
      rows.lessons.push(created)
      return created
    },
    updateLesson: async (id, patch: EntityPatch<Lesson>) => {
      const index = rows.lessons.findIndex((row) => row.id === id)
      if (index === -1) throw new Error(`no lesson ${id}`)
      const updated = {
        ...(rows.lessons[index] as Lesson),
        ...patch,
        updatedAt: clock.now(),
        version: (rows.lessons[index] as Lesson).version + 1,
      } as Lesson
      rows.lessons[index] = updated
      return updated
    },
    softDeleteLesson: async (id) => {
      const index = rows.lessons.findIndex((row) => row.id === id)
      if (index !== -1) {
        rows.lessons[index] = { ...(rows.lessons[index] as Lesson), deletedAt: clock.now() }
      }
    },
    createActivities: async (inputs: readonly NewEntity<Activity>[]) => {
      const created = inputs.map((input) => auditNew(input) as Activity)
      rows.activities.push(...created)
      return created
    },
    findActivities: async (activityIds) =>
      rows.activities.filter((row) => activityIds.includes(row.id)),
    listActivitiesByConcepts: async (conceptIds) =>
      live(rows.activities).filter((row) => row.conceptIds.some((id) => conceptIds.includes(id))),
  }

  const remediations: RemediationUnitOfWork['remediations'] = {
    findById: async (id) => rows.remediations.find((row) => row.id === id),
    findMany: async (idList) => rows.remediations.filter((row) => idList.includes(row.id)),
    list: async () => live(rows.remediations),
    count: async () => live(rows.remediations).length,
    create: async (input: NewEntity<Remediation>) => {
      const created = auditNew(input) as Remediation
      rows.remediations.push(created)
      return created
    },
    update: async (id, patch: EntityPatch<Remediation>) => {
      const index = rows.remediations.findIndex((row) => row.id === id)
      if (index === -1) throw new Error(`no remediation ${id}`)
      const updated = {
        ...(rows.remediations[index] as Remediation),
        ...patch,
        updatedAt: clock.now(),
        version: (rows.remediations[index] as Remediation).version + 1,
      } as Remediation
      rows.remediations[index] = updated
      return updated
    },
    save: async (entity) => {
      const index = rows.remediations.findIndex((row) => row.id === entity.id)
      if (index === -1) {
        const created = auditNew(entity) as Remediation
        rows.remediations.push(created)
        return created
      }
      const updated = {
        ...(rows.remediations[index] as Remediation),
        ...entity,
        updatedAt: clock.now(),
        version: (rows.remediations[index] as Remediation).version + 1,
      } as Remediation
      rows.remediations[index] = updated
      return updated
    },
    softDelete: async (id) => {
      const index = rows.remediations.findIndex((row) => row.id === id)
      if (index !== -1) {
        rows.remediations[index] = {
          ...(rows.remediations[index] as Remediation),
          deletedAt: clock.now(),
        }
      }
    },
    restore: async (id) => {
      const index = rows.remediations.findIndex((row) => row.id === id)
      if (index !== -1) {
        rows.remediations[index] = { ...(rows.remediations[index] as Remediation), deletedAt: null }
      }
    },
    listByPathVersion: async (pathVersionId) =>
      live(rows.remediations)
        .filter((row) => row.pathVersionId === pathVersionId)
        .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    listByPathId: async (pathId) => {
      const versionIds = new Set(
        rows.versions.filter((row) => row.pathId === pathId).map((row) => row.id),
      )
      return live(rows.remediations)
        .filter((row) => versionIds.has(row.pathVersionId))
        .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    },
    listByStatus: async (statuses: readonly RemediationStatus[]) =>
      live(rows.remediations)
        .filter((row) => statuses.includes(row.status))
        .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    listSince: async (from) =>
      live(rows.remediations)
        .filter((row) => row.createdAt.getTime() >= from.getTime())
        .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    findByLesson: async (lessonId) => rows.remediations.find((row) => row.lessonId === lessonId),
  }

  const itemBank: RemediationRepos['itemBank'] = {
    listByUsage: async (pathVersionId, usage: ItemUsage) =>
      live(rows.itemBank).filter(
        (row) => row.pathVersionId === pathVersionId && row.usage.includes(usage),
      ),
    bumpExposure: async (idList) => {
      for (const id of idList) {
        const index = rows.itemBank.findIndex((row) => row.id === id)
        if (index !== -1) {
          rows.itemBank[index] = {
            ...(rows.itemBank[index] as ItemBankEntry),
            exposure: (rows.itemBank[index] as ItemBankEntry).exposure + 1,
          }
        }
      }
    },
  }

  const knowledgeItems: RemediationRepos['knowledgeItems'] = {
    findById: async (id) => rows.knowledgeItems.find((row) => row.id === id),
    listByTopic: async (topicId) =>
      live(rows.knowledgeItems).filter((row) => row.topicId === topicId),
    listByLesson: async (lessonId) =>
      live(rows.knowledgeItems).filter((row) => row.lessonId === lessonId),
    create: async (input) => {
      const created = auditNew(input) as KnowledgeItem
      rows.knowledgeItems.push(created)
      return created
    },
    update: async (id, patch: EntityPatch<KnowledgeItem>) => {
      const index = rows.knowledgeItems.findIndex((row) => row.id === id)
      if (index === -1) throw new Error(`no knowledge item ${id}`)
      const updated = {
        ...(rows.knowledgeItems[index] as KnowledgeItem),
        ...patch,
        updatedAt: clock.now(),
        version: (rows.knowledgeItems[index] as KnowledgeItem).version + 1,
      } as KnowledgeItem
      rows.knowledgeItems[index] = updated
      return updated
    },
  }

  const cardsRepo: RemediationRepos['cards'] = {
    findById: async (id) => rows.cards.find((row) => row.id === id),
    listByItems: async (itemIds) => live(rows.cards).filter((row) => itemIds.includes(row.itemId)),
    overrideImportance: async (idList, level, expiresAt) => {
      let written = 0
      for (const id of idList) {
        const index = rows.cards.findIndex((row) => row.id === id)
        if (index === -1) continue
        rows.cards[index] = {
          ...(rows.cards[index] as Card),
          importanceOverride: level,
          importanceOverrideExpiresAt: expiresAt ?? null,
        }
        written += 1
      }
      return written
    },
    create: async (input) => {
      const created = auditNew(input) as Card
      rows.cards.push(created)
      return created
    },
  }

  const reviewLogs: RemediationRepos['reviewLogs'] = {
    listSince: async (from, to) =>
      rows.reviewLogs
        .filter(
          (row) =>
            row.review.getTime() >= from.getTime() &&
            (to === undefined || row.review.getTime() < to.getTime()),
        )
        .toSorted((a, b) => a.review.getTime() - b.review.getTime()),
  }

  const attempts: RemediationRepos['attempts'] = {
    listSince: async (from, to) =>
      rows.attempts
        .filter(
          (row) =>
            row.startedAt.getTime() >= from.getTime() &&
            (to === undefined || row.startedAt.getTime() < to.getTime()),
        )
        .toSorted((a, b) => a.startedAt.getTime() - b.startedAt.getTime()),
  }

  const repos: RemediationUnitOfWork & { rows: RemediationWorldRows } = {
    rows,
    paths,
    remediations,
    itemBank,
    chunks: {
      findMany: async (chunkIds) => rows.chunks.filter((row) => chunkIds.includes(row.id)),
    },
    knowledgeItems,
    cards: cardsRepo,
    reviewLogs,
    attempts,
    transaction: async (work) =>
      work({
        paths,
        remediations,
        itemBank,
        chunks: repos.chunks,
        knowledgeItems,
        cards: cardsRepo,
        reviewLogs,
        attempts,
      }),
  }

  return {
    rows,
    repos,
    clock,
    ids,
    pathId,
    pathVersionId: versionId,
    sectionId,
    moduleIds: { M01: module1Id, M02: module2Id },
    lessonIds: { L01: lesson1Id, L02: lesson2Id, L03: lesson3Id, L04: lesson4Id },
    concepts,
    draft,
    graph,
    itemOf: (conceptId) => items.find((item) => item.topicId === conceptId) as KnowledgeItem,
    cardsOf: (conceptId) => {
      const item = items.find((entry) => entry.topicId === conceptId) as KnowledgeItem
      return rows.cards.filter((card) => card.itemId === item.id)
    },
    author: fakeRemediationAuthor(),
    ai: fakeRemediationAi(),
  }
}
