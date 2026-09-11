import type {
  Activity,
  Chunk,
  Clock,
  EntityPatch,
  ItemBankEntry,
  ItemUsage,
  LearningPath,
  Lesson,
  Module,
  NewEntity,
  PathTree,
  PathVersion,
  Section,
} from '@retenia/core'
import { createUuidV7Generator } from '@retenia/core'
import type { ItemBankRepos, ItemBankTxRepos } from '../item-bank/build'
import type { ReconcileRepos } from '../item-bank/reconcile'
import type { KnowledgeGraphDocument } from '../schemas/knowledge-graph'
import type { PathDraft } from '../schemas/path-draft'

/**
 * A frozen path with a knowledge graph, exactly as it exists right after "Confirmar ruta"
 * and before the item bank has ever been built (`docs/spec/04-path-generation.md` §3 stage
 * 9): two modules of different weight and Bloom mix, each with one lesson that already has
 * an activity — the "questions the diagnostic and the exam must not repeat" the bank's
 * dedupe (§14 pitfall 3) is checked against.
 *
 * Small and shared by `build.test.ts` and `reconcile.test.ts`, the way `expand-world.ts` is
 * shared by stage 7's suite: one fixture, one place to change it.
 */

export interface ItemBankRows {
  readonly paths: LearningPath[]
  readonly versions: PathVersion[]
  readonly sections: Section[]
  readonly modules: Module[]
  readonly lessons: Lesson[]
  readonly activities: Activity[]
  readonly chunks: Chunk[]
  readonly itemBank: ItemBankEntry[]
}

export interface ItemBankWorld {
  readonly rows: ItemBankRows
  readonly draft: PathDraft
  readonly graph: KnowledgeGraphDocument
  readonly pathId: string
  readonly pathVersionId: string
}

export interface ItemBankWorldOptions {
  readonly examItemCount?: number
  readonly frozen?: boolean
  /** `module_id -> weight`, in draft module order. Defaults to an even split. */
  readonly moduleWeights?: readonly number[]
  readonly lessonStems?: { readonly m01?: string; readonly m02?: string }
}

export function itemBankWorld(clock: Clock, options: ItemBankWorldOptions = {}): ItemBankWorld {
  const ids = createUuidV7Generator(clock)
  const now = clock.now()
  const audit = { createdAt: now, updatedAt: now, deletedAt: null, deviceId: 'test', version: 1 }
  const weights = options.moduleWeights ?? [1, 1]
  const examItemCount = options.examItemCount ?? 4

  const pathId = ids.next()
  const versionId = ids.next()
  const sectionId = ids.next()
  const module1Id = ids.next()
  const module2Id = ids.next()
  const lesson1Id = ids.next()
  const lesson2Id = ids.next()
  const activity1Id = ids.next()
  const activity2Id = ids.next()

  const chunk1: Chunk = {
    id: 'chunk-M01',
    sourceId: 'src-book',
    unitId: null,
    ordinal: 0,
    text: 'La memoria de trabajo retiene unos cuatro elementos por un breve lapso.',
    charStart: 0,
    charEnd: 60,
    tokenCount: 15,
    hash: 'hash-chunk-M01',
    headingPath: 'Libro > Cap. 1',
    context: null,
    chunkKey: 'key-chunk-M01',
    chunkingVersion: null,
    isFrontmatter: false,
    locator: { page: 1, block_ids: ['M01-b1'] },
    ...audit,
  }
  const chunk2: Chunk = {
    ...chunk1,
    id: 'chunk-M02',
    ordinal: 1,
    text: 'Aplicar lo aprendido exige practicar con ejemplos nuevos, no solo reconocerlos.',
    hash: 'hash-chunk-M02',
    headingPath: 'Libro > Cap. 2',
    chunkKey: 'key-chunk-M02',
    locator: { page: 2, block_ids: ['M02-b1'] },
  }

  const lessonActivityStem1 =
    options.lessonStems?.m01 ?? 'La memoria de trabajo retiene información breve.'
  const lessonActivityStem2 =
    options.lessonStems?.m02 ?? '¿Qué produce una interferencia en la memoria de trabajo?'

  const draft: PathDraft = {
    version: 1,
    kind: 'draft',
    title: 'Memoria',
    language: 'es-AR',
    target_language: null,
    level: 'beginner',
    goal: 'Entender la memoria de trabajo',
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
            objectives: [{ text: 'Explicar la memoria', bloom: 'understand' }],
            concept_ids: ['c1'],
            lessons: [
              {
                id: 'L01',
                kind: 'core',
                title: 'Lección 1',
                concept_ids: ['c1'],
                warmup_concept_ids: [],
                objectives: [{ text: 'Explicar la memoria', bloom: 'understand' }],
                prerequisite_lesson_ids: [],
                estimated_minutes: 10,
                source_refs: [
                  {
                    source_id: 'src-book',
                    chunk_id: 'chunk-M01',
                    chunk_key: 'key-chunk-M01',
                    block_ids: ['M01-b1'],
                    heading_path: 'Libro > Cap. 1',
                    ordinal: 0,
                  },
                ],
                origin: 'model',
              },
            ],
            reinforcement: {
              id: 'M01.reinf',
              kind: 'reinforcement',
              module_id: 'M01',
              concept_ids: ['c1'],
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
            objectives: [
              { text: 'Aplicar la memoria', bloom: 'apply' },
              { text: 'Analizar los errores', bloom: 'analyze' },
            ],
            concept_ids: ['c2'],
            lessons: [
              {
                id: 'L02',
                kind: 'core',
                title: 'Lección 2',
                concept_ids: ['c2'],
                warmup_concept_ids: [],
                objectives: [{ text: 'Aplicar la memoria', bloom: 'apply' }],
                prerequisite_lesson_ids: [],
                estimated_minutes: 10,
                source_refs: [
                  {
                    source_id: 'src-book',
                    chunk_id: 'chunk-M02',
                    chunk_key: 'key-chunk-M02',
                    block_ids: ['M02-b1'],
                    heading_path: 'Libro > Cap. 2',
                    ordinal: 0,
                  },
                ],
                origin: 'model',
              },
            ],
            reinforcement: {
              id: 'M02.reinf',
              kind: 'reinforcement',
              module_id: 'M02',
              concept_ids: ['c2'],
              earlier_concept_ids: ['c1'],
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
          { module_id: 'M01', weight: weights[0] ?? 1 },
          { module_id: 'M02', weight: weights[1] ?? 1 },
        ],
        item_count: examItemCount,
      },
      estimated_minutes: 30,
    },
    misconceptions: [
      { id: 'X001', concept_id: 'c1', text: 'Retiene siete', why_wrong: 'El número es cuatro.' },
    ],
    excluded: [],
    stats: {
      sections: 1,
      modules: 2,
      lessons: 2,
      checkpoints: 0,
      concepts: 2,
      minutes: 40,
      weeks_estimate: 1,
    },
    warnings: [],
    known_node_ids: [],
    qa_mode: 'full',
  }

  const graph: KnowledgeGraphDocument = {
    version: 1,
    embedding_model_id: null,
    threshold: 0.86,
    nodes: [
      {
        concept_id: 'c1',
        canonical: 'Memoria de trabajo',
        aliases: [],
        definition: 'Retén breve de información.',
        kind: 'concept',
        bloom_target: 'understand',
        difficulty: 2,
        importance: 0.9,
        source_refs: [
          {
            source_id: 'src-book',
            chunk_id: 'chunk-M01',
            chunk_key: 'key-chunk-M01',
            block_ids: ['M01-b1'],
            heading_path: 'Libro > Cap. 1',
            ordinal: 0,
          },
        ],
      },
      {
        concept_id: 'c2',
        canonical: 'Interferencia',
        aliases: [],
        definition: 'Pérdida de acceso por competencia entre recuerdos.',
        kind: 'concept',
        bloom_target: 'analyze',
        difficulty: 3,
        importance: 0.7,
        source_refs: [
          {
            source_id: 'src-book',
            chunk_id: 'chunk-M02',
            chunk_key: 'key-chunk-M02',
            block_ids: ['M02-b1'],
            heading_path: 'Libro > Cap. 2',
            ordinal: 0,
          },
        ],
      },
    ],
    edges: [],
  }

  const path: LearningPath = {
    id: pathId,
    title: 'Memoria',
    language: 'es-AR',
    level: 'beginner',
    goal: 'Entender la memoria de trabajo',
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
    frozenAt: options.frozen === false ? null : now,
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

  const lesson1: Lesson = {
    id: lesson1Id,
    moduleId: module1Id,
    ordinal: 0,
    specId: 'L01',
    kind: 'core',
    parentLessonId: null,
    title: 'Lección 1',
    status: 'ready',
    objectives: [],
    conceptIds: ['c1'],
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
  }
  const lesson2: Lesson = {
    ...lesson1,
    id: lesson2Id,
    moduleId: module2Id,
    specId: 'L02',
    title: 'Lección 2',
    conceptIds: ['c2'],
  }

  const activity1: Activity = {
    id: activity1Id,
    lessonId: lesson1Id,
    ordinal: 0,
    type: 'mcq_single',
    family: 'choice',
    schemaVersion: 1,
    lang: 'es-AR',
    bloom: 'understand',
    difficulty: 2,
    conceptIds: ['c1'],
    misconceptionIds: [],
    config: { prompt: lessonActivityStem1 },
    grading: { method: 'det' },
    status: 'ready',
    sourceRefs: [],
    ...audit,
  }
  const activity2: Activity = {
    ...activity1,
    id: activity2Id,
    lessonId: lesson2Id,
    conceptIds: ['c2'],
    config: { prompt: lessonActivityStem2 },
  }

  return {
    rows: {
      paths: [path],
      versions: [version],
      sections: [section],
      modules: [module1, module2],
      lessons: [lesson1, lesson2],
      activities: [activity1, activity2],
      chunks: [chunk1, chunk2],
      itemBank: [],
    },
    draft,
    graph,
    pathId,
    pathVersionId: versionId,
  }
}

/**
 * Both surfaces in one fake: the build's `ItemBankRepos` and the reconcile's `ReconcileRepos`
 * narrow `paths` and `itemBank` to different `Pick`s, so the members are their intersections
 * rather than an `extends` of both (which TypeScript rejects for conflicting members).
 */
export interface ItemBankMemoryRepos {
  readonly paths: ItemBankRepos['paths'] & ReconcileRepos['paths'] & ItemBankTxRepos['paths']
  readonly itemBank: ItemBankRepos['itemBank'] &
    ReconcileRepos['itemBank'] &
    ItemBankTxRepos['itemBank']
  readonly chunks: ItemBankRepos['chunks']
  transaction: ItemBankRepos['transaction']
  readonly rows: ItemBankRows
  transactions(): number
}

/** The slice of the repositories the bank's build and its reconcile touch, in memory. */
export function createItemBankRepos(clock: Clock, seed: ItemBankRows): ItemBankMemoryRepos {
  const ids = createUuidV7Generator(clock)
  const rows = seed
  let transactions = 0

  const audit = <T extends object>(input: T & { id?: string }) => {
    const now = clock.now()
    return {
      ...(input as T),
      id: input.id ?? ids.next(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deviceId: 'test',
      version: 1,
    }
  }

  const live = <T extends { deletedAt: Date | null }>(list: readonly T[]): T[] =>
    list.filter((row) => row.deletedAt === null)

  const createActivity = async (input: NewEntity<Activity>): Promise<Activity> => {
    const created = audit(input) as Activity
    rows.activities.push(created)
    return created
  }
  const createItem = async (input: NewEntity<ItemBankEntry>): Promise<ItemBankEntry> => {
    const created = audit(input) as ItemBankEntry
    rows.itemBank.push(created)
    return created
  }

  const paths: ItemBankMemoryRepos['paths'] = {
    findVersion: async (id) => rows.versions.find((row) => row.id === id),
    loadTree: async (versionId): Promise<PathTree | undefined> => {
      const version = rows.versions.find((row) => row.id === versionId)
      if (version === undefined) return undefined
      const path = rows.paths.find((row) => row.id === version.pathId)
      if (path === undefined) return undefined
      return {
        path,
        version,
        sections: live(rows.sections)
          .filter((section) => section.pathVersionId === versionId)
          .toSorted((left, right) => left.ordinal - right.ordinal)
          .map((section) => ({
            ...section,
            modules: live(rows.modules)
              .filter((module) => module.sectionId === section.id)
              .toSorted((left, right) => left.ordinal - right.ordinal)
              .map((module) => ({
                ...module,
                lessons: live(rows.lessons)
                  .filter((lesson) => lesson.moduleId === module.id)
                  .toSorted((left, right) => left.ordinal - right.ordinal)
                  .map((lesson) => ({
                    ...lesson,
                    activities: live(rows.activities).filter(
                      (activity) => activity.lessonId === lesson.id,
                    ),
                  })),
              })),
          })),
      }
    },
    findActivities: async (activityIds) =>
      rows.activities.filter((row) => activityIds.includes(row.id)),
    updateModule: async (id, patch: EntityPatch<Module>) => {
      const index = rows.modules.findIndex((row) => row.id === id)
      if (index === -1) throw new Error(`no module ${id}`)
      const updated = {
        ...(rows.modules[index] as Module),
        ...patch,
        updatedAt: clock.now(),
        version: (rows.modules[index] as Module).version + 1,
      } as Module
      rows.modules[index] = updated
      return updated
    },
    createActivity,
    listActivities: async (lessonId) =>
      live(rows.activities).filter((row) => row.lessonId === lessonId),
    findModule: async (id) => rows.modules.find((row) => row.id === id),
    softDeleteActivity: async (id) => {
      const index = rows.activities.findIndex((row) => row.id === id)
      if (index !== -1) {
        rows.activities[index] = {
          ...(rows.activities[index] as Activity),
          deletedAt: clock.now(),
        }
      }
    },
  }

  const itemBank: ItemBankMemoryRepos['itemBank'] = {
    listByPathVersion: async (pathVersionId) =>
      live(rows.itemBank).filter((row) => row.pathVersionId === pathVersionId),
    create: createItem,
    update: async (id, patch: EntityPatch<ItemBankEntry>) => {
      const index = rows.itemBank.findIndex((row) => row.id === id)
      if (index === -1) throw new Error(`no item_bank row ${id}`)
      const updated = {
        ...(rows.itemBank[index] as ItemBankEntry),
        ...patch,
        updatedAt: clock.now(),
        version: (rows.itemBank[index] as ItemBankEntry).version + 1,
      } as ItemBankEntry
      rows.itemBank[index] = updated
      return updated
    },
    softDelete: async (id) => {
      const index = rows.itemBank.findIndex((row) => row.id === id)
      if (index !== -1) {
        rows.itemBank[index] = {
          ...(rows.itemBank[index] as ItemBankEntry),
          deletedAt: clock.now(),
        }
      }
    },
  }

  const repos: ItemBankMemoryRepos = {
    rows,
    transactions: () => transactions,
    paths,
    itemBank,
    chunks: {
      findMany: async (chunkIds) => rows.chunks.filter((row) => chunkIds.includes(row.id)),
    },
    transaction: async <T>(work: (tx: ItemBankTxRepos) => Promise<T>): Promise<T> => {
      transactions += 1
      return work({ paths: { createActivity }, itemBank: { create: createItem } })
    },
  }
  return repos
}

/** A bank usage tag every item can be filtered on, exported so tests read like the spec. */
export const ANY_USAGE: readonly ItemUsage[] = [
  'diagnostic',
  'reinforcement',
  'final_exam_A',
  'final_exam_B',
  'remediation',
  'mock',
]
