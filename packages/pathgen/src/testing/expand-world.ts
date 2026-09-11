import type {
  Chunk,
  Clock,
  LearningPath,
  Lesson,
  Module,
  PathVersion,
  Section,
} from '@retenia/core'
import { createUuidV7Generator } from '@retenia/core'
import { emptyExpansion } from '../expand/expansion'
import type { ConceptFacts } from '../expand/plan'
import type { CoreLessonNode, PathDraft } from '../schemas/path-draft'
import type { ExpandRows } from './expand-repos'

/**
 * A frozen path exactly as `freezePath` leaves one: a version whose `spec` is a `PathDraft`,
 * a tree of rows, and every core lesson `pending` with `theory: null`.
 *
 * Small on purpose — one section, one module, four lessons — because what the expansion suite
 * is about is the head/tail split, the waves and the resume, and four lessons is the smallest
 * number that has both a head and a tail.
 */

export interface ExpandWorld {
  readonly rows: ExpandRows
  readonly draft: PathDraft
  readonly concepts: ReadonlyMap<string, ConceptFacts>
  readonly pathId: string
  readonly pathVersionId: string
}

export interface ExpandWorldOptions {
  readonly lessons?: number
  /** Text to plant in the first lesson's chunk, for the injection guard. */
  readonly plantedInjection?: string
}

export function expandWorld(clock: Clock, options: ExpandWorldOptions = {}): ExpandWorld {
  const ids = createUuidV7Generator(clock)
  const count = options.lessons ?? 4
  const now = clock.now()
  const audit = { createdAt: now, updatedAt: now, deletedAt: null, deviceId: 'test', version: 1 }

  const pathId = ids.next()
  const versionId = ids.next()
  const sectionId = ids.next()
  const moduleId = ids.next()

  const chunks: Chunk[] = []
  const nodes: CoreLessonNode[] = []
  const lessons: Lesson[] = []

  for (let index = 0; index < count; index += 1) {
    const specId = `L0${index + 1}`
    const chunkId = `chunk-${specId}`
    const planted = index === 0 && options.plantedInjection !== undefined
    chunks.push({
      id: chunkId,
      sourceId: 'src-book',
      unitId: null,
      ordinal: index,
      text: planted
        ? `${options.plantedInjection as string}\nLa memoria de trabajo retiene unos cuatro elementos.`
        : `Fragmento ${specId}: la memoria de trabajo retiene unos cuatro elementos.`,
      charStart: 0,
      charEnd: 80,
      tokenCount: 20,
      hash: `hash-${chunkId}`,
      headingPath: `Libro > Cap. ${index + 1}`,
      context: null,
      chunkKey: `key-${chunkId}`,
      chunkingVersion: null,
      isFrontmatter: false,
      locator: { page: index + 1, block_ids: [`${specId}-b1`] },
      ...audit,
    })

    nodes.push({
      id: specId,
      kind: 'core',
      title: `Lección ${index + 1}`,
      concept_ids: ['c1'],
      warmup_concept_ids: [],
      objectives: [{ text: 'Explicar la capacidad limitada', bloom: 'understand' }],
      prerequisite_lesson_ids: [],
      estimated_minutes: 10,
      source_refs: [
        {
          source_id: 'src-book',
          chunk_id: chunkId,
          chunk_key: `key-${chunkId}`,
          block_ids: [`${specId}-b1`],
          heading_path: `Libro > Cap. ${index + 1}`,
          ordinal: index,
        },
      ],
      origin: 'model',
    })

    lessons.push({
      id: ids.next(),
      moduleId,
      ordinal: index,
      specId,
      kind: 'core',
      parentLessonId: null,
      title: `Lección ${index + 1}`,
      status: 'pending',
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
    })
  }

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
            lessons: nodes,
            reinforcement: {
              id: 'M01.reinf',
              kind: 'reinforcement',
              module_id: 'M01',
              concept_ids: ['c1'],
              earlier_concept_ids: [],
              item_count: 10,
              estimated_minutes: 8,
            },
            checkpoint: null,
            estimated_minutes: 40,
          },
        ],
      },
    ],
    final_exam: {
      id: 'FINAL',
      kind: 'final_exam',
      blueprint: { topics: [{ module_id: 'M01', weight: 1 }], item_count: 20 },
      estimated_minutes: 30,
    },
    misconceptions: [
      { id: 'X001', concept_id: 'c1', text: 'Retiene siete', why_wrong: 'El número es cuatro.' },
    ],
    excluded: [],
    stats: {
      sections: 1,
      modules: 1,
      lessons: count,
      checkpoints: 0,
      concepts: 1,
      minutes: 40,
      weeks_estimate: 1,
    },
    warnings: [],
    known_node_ids: [],
    qa_mode: 'full',
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
    knowledgeGraph: null,
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

  const module: Module = {
    id: moduleId,
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

  return {
    rows: {
      paths: [path],
      versions: [version],
      sections: [section],
      modules: [module],
      lessons,
      activities: [],
      knowledgeItems: [],
      cards: [],
      chunks,
    },
    draft,
    concepts: new Map<string, ConceptFacts>([
      [
        'c1',
        {
          id: 'c1',
          name: 'Memoria de trabajo',
          definition: 'Retén breve.',
          kind: 'concept',
          aliases: ['memoria operativa'],
          importance: 0.9,
        },
      ],
    ]),
    pathId,
    pathVersionId: versionId,
  }
}

/** A ledger for a lesson that has not been touched yet. */
export const freshExpansion = emptyExpansion
