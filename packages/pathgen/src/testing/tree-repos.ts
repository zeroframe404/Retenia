import type {
  Activity,
  LearningPath,
  Lesson,
  Module,
  NewEntity,
  PathTree,
  PathVersion,
  Section,
} from '@retenia/core'
import { type Clock, createUuidV7Generator, EntityNotFoundError } from '@retenia/core'
import type { FreezeRepos } from '../freeze/freeze-path'

/**
 * A minimal in-memory `PathRepository`, just the tree-writing surface `freezePath` and
 * `applyEdit`'s persistence use — `testing/memory-repos.ts` only covers the narrower slice
 * `GenerationRepos` needs (no `createSection`/`freezeVersion`/`loadTree`), so this is a second,
 * purpose-built fake rather than widening that one for a use case it was never meant to serve.
 */

export interface TreeRepos extends FreezeRepos {
  readonly rows: {
    readonly paths: LearningPath[]
    readonly versions: PathVersion[]
    readonly sections: Section[]
    readonly modules: Module[]
    readonly lessons: Lesson[]
    readonly activities: Activity[]
  }
  /** Test-only convenience: not part of `FreezeRepos`, just fixture setup. */
  seedPath(overrides?: Partial<NewEntity<LearningPath>>): LearningPath
  seedVersion(pathId: string, overrides?: Partial<NewEntity<PathVersion>>): PathVersion
}

type Audited<T> = T & {
  id: string
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  deviceId: string
  version: number
}

export function createTreeRepos(
  clock: Clock,
  seed: {
    readonly paths?: readonly LearningPath[]
    readonly versions?: readonly PathVersion[]
  } = {},
): TreeRepos {
  const ids = createUuidV7Generator(clock)
  const rows = {
    paths: [...(seed.paths ?? [])],
    versions: [...(seed.versions ?? [])],
    sections: [] as Section[],
    modules: [] as Module[],
    lessons: [] as Lesson[],
    activities: [] as Activity[],
  }

  const audit = <T extends object>(input: T & { id?: string }): Audited<T> => {
    const now = clock.now()
    const { id, ...rest } = input
    return {
      ...(rest as T),
      id: id ?? ids.next(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deviceId: 'test-device',
      version: 1,
    }
  }

  const live = <T extends { deletedAt: Date | null }>(list: readonly T[]): T[] =>
    list.filter((row) => row.deletedAt === null)

  const patch = <T extends { id: string; updatedAt: Date; version: number }>(
    list: T[],
    id: string,
    changes: object,
    what: string,
  ): T => {
    const index = list.findIndex((row) => row.id === id)
    const current = list[index]
    if (current === undefined) throw new EntityNotFoundError(what, id)
    const next = { ...current, ...changes, updatedAt: clock.now(), version: current.version + 1 }
    list[index] = next
    return next
  }

  const paths: TreeRepos['paths'] = {
    findVersion: async (id) => live(rows.versions).find((v) => v.id === id),
    findVersionByNumber: async (pathId, number) =>
      live(rows.versions).find((v) => v.pathId === pathId && v.number === number),
    findById: async (id) => live(rows.paths).find((p) => p.id === id),
    update: async (id, changes) => patch(rows.paths, id, changes, 'paths'),
    updateVersion: async (id, changes) => patch(rows.versions, id, changes, 'path_versions'),
    updateLesson: async (id, changes) => patch(rows.lessons, id, changes, 'lessons'),
    createSection: async (input: NewEntity<Section>) => {
      const row = audit(input)
      rows.sections.push(row)
      return row
    },
    createModule: async (input: NewEntity<Module>) => {
      const row = audit(input)
      rows.modules.push(row)
      return row
    },
    createLesson: async (input: NewEntity<Lesson>) => {
      const row = audit(input)
      rows.lessons.push(row)
      return row
    },
    freezeVersion: async (versionId, at) =>
      patch(rows.versions, versionId, { frozenAt: at }, 'path_versions'),
    setActiveVersion: async (pathId, number) => {
      const exists = live(rows.versions).some((v) => v.pathId === pathId && v.number === number)
      if (!exists) throw new EntityNotFoundError('path_versions', `${pathId}#${number}`)
      return patch(rows.paths, pathId, { activeVersion: number }, 'paths')
    },
    loadTree: async (versionId): Promise<PathTree | undefined> => {
      const version = live(rows.versions).find((v) => v.id === versionId)
      if (version === undefined) return undefined
      const path = live(rows.paths).find((p) => p.id === version.pathId)
      if (path === undefined) return undefined
      const sections = live(rows.sections)
        .filter((s) => s.pathVersionId === versionId)
        .sort((a, b) => a.ordinal - b.ordinal)
      return {
        path,
        version,
        sections: sections.map((section) => {
          const modules = live(rows.modules)
            .filter((m) => m.sectionId === section.id)
            .sort((a, b) => a.ordinal - b.ordinal)
          return {
            ...section,
            modules: modules.map((module) => {
              const lessons = live(rows.lessons)
                .filter((l) => l.moduleId === module.id)
                .sort((a, b) => a.ordinal - b.ordinal)
              return {
                ...module,
                lessons: lessons.map((lessonRow) => ({
                  ...lessonRow,
                  activities: live(rows.activities).filter((a) => a.lessonId === lessonRow.id),
                })),
              }
            }),
          }
        }),
      }
    },
  }

  return {
    paths,
    rows,
    seedPath: (overrides = {}) => {
      const row = audit<NewEntity<LearningPath>>({
        title: 'Curso de prueba',
        language: 'es-AR',
        level: 'beginner',
        goal: 'Aprender',
        targetDate: null,
        status: 'draft',
        activeVersion: null,
        sourceIds: ['src-1'],
        settings: null,
        ...overrides,
      })
      rows.paths.push(row)
      return row
    },
    seedVersion: (pathId, overrides = {}) => {
      const row = audit<NewEntity<PathVersion>>({
        pathId,
        number: rows.versions.filter((v) => v.pathId === pathId).length + 1,
        spec: {},
        knowledgeGraph: null,
        manifest: null,
        diff: null,
        frozenAt: null,
        ...overrides,
      })
      rows.versions.push(row)
      return row
    },
  }
}
