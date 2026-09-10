import type {
  Activity,
  Card,
  Chunk,
  Clock,
  EntityPatch,
  KnowledgeItem,
  LearningPath,
  Lesson,
  Module,
  NewEntity,
  PathTree,
  PathVersion,
  Section,
} from '@retenia/core'
import { createUuidV7Generator, EntityNotFoundError } from '@retenia/core'
import type { ExpandRepos } from '../expand/deps'

/**
 * The slice of the repositories stage 7 touches, in memory.
 *
 * A third fake beside `memory-repos.ts` (the generation run's) and `tree-repos.ts` (the
 * freeze's), for the reason `tree-repos.ts` gives for being the second: widening one fake for
 * a use case it was never meant to serve makes every test that uses it read the wrong surface.
 * `packages/db`'s contract suites are what prove the SQLite repositories agree with these.
 */

type Audited<T> = T & {
  id: string
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  deviceId: string
  version: number
}

export interface ExpandRows {
  readonly paths: LearningPath[]
  readonly versions: PathVersion[]
  readonly sections: Section[]
  readonly modules: Module[]
  readonly lessons: Lesson[]
  readonly activities: Activity[]
  readonly knowledgeItems: KnowledgeItem[]
  readonly cards: Card[]
  readonly chunks: Chunk[]
}

export interface ExpandMemoryRepos extends ExpandRepos {
  readonly rows: ExpandRows
  transactions(): number
}

export function createExpandRepos(clock: Clock, seed: Partial<ExpandRows> = {}): ExpandMemoryRepos {
  const ids = createUuidV7Generator(clock)
  const rows: ExpandRows = {
    paths: [...(seed.paths ?? [])],
    versions: [...(seed.versions ?? [])],
    sections: [...(seed.sections ?? [])],
    modules: [...(seed.modules ?? [])],
    lessons: [...(seed.lessons ?? [])],
    activities: [...(seed.activities ?? [])],
    knowledgeItems: [...(seed.knowledgeItems ?? [])],
    cards: [...(seed.cards ?? [])],
    chunks: [...(seed.chunks ?? [])],
  }
  let transactions = 0

  const audit = <T extends object>(input: T & { id?: string }): Audited<T> => {
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

  const paths: ExpandRepos['paths'] = {
    findById: async (id) => rows.paths.find((row) => row.id === id),
    findVersion: async (id) => rows.versions.find((row) => row.id === id),
    findLesson: async (id) => rows.lessons.find((row) => row.id === id),
    listActivities: async (lessonId) =>
      live(rows.activities).filter((row) => row.lessonId === lessonId),
    updateLesson: async (id, patch: EntityPatch<Lesson>) => {
      const index = rows.lessons.findIndex((row) => row.id === id)
      if (index === -1) throw new EntityNotFoundError('lessons', id)
      const updated = {
        ...(rows.lessons[index] as Lesson),
        ...patch,
        updatedAt: clock.now(),
        version: (rows.lessons[index] as Lesson).version + 1,
      } as Lesson
      rows.lessons[index] = updated
      return updated
    },
    createActivities: async (inputs: readonly NewEntity<Activity>[]) => {
      const created = inputs.map((input) => audit(input) as Activity)
      rows.activities.push(...created)
      return created
    },
    softDeleteActivity: async (id) => {
      const index = rows.activities.findIndex((row) => row.id === id)
      if (index !== -1) {
        rows.activities[index] = {
          ...(rows.activities[index] as Activity),
          deletedAt: clock.now(),
        }
      }
    },
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
  }

  const repos: ExpandMemoryRepos = {
    rows,
    transactions: () => transactions,
    paths,
    chunks: {
      findMany: async (chunkIds) => rows.chunks.filter((row) => chunkIds.includes(row.id)),
    },
    knowledgeItems: {
      listByLesson: async (lessonId) =>
        live(rows.knowledgeItems).filter((row) => row.lessonId === lessonId),
      create: async (input) => {
        const created = audit(input) as KnowledgeItem
        rows.knowledgeItems.push(created)
        return created
      },
    },
    cards: {
      create: async (input) => {
        const created = audit(input) as Card
        rows.cards.push(created)
        return created
      },
    },
    transaction: async (work) => {
      transactions += 1
      return work(repos)
    },
  }
  return repos
}
