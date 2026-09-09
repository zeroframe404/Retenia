import type {
  Chunk,
  Clock,
  EntityPatch,
  Extraction,
  GenerationRun,
  LearningPath,
  NewEntity,
  PathVersion,
  Source,
} from '@retenia/core'
import { createUuidV7Generator } from '@retenia/core'
import type { GenerationRepos } from '../run/deps'

/**
 * The slice of the repositories a generation run touches, in memory.
 *
 * Only what `GenerationRepos` picks: the end-to-end test and the orchestrator tests drive the
 * real pipeline over these, and `packages/db`'s contract suites are what prove the SQLite
 * repositories behave the same way.
 */

type Audited<T> = T & {
  id: string
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  deviceId: string
  version: number
}

export interface MemoryRepos extends GenerationRepos {
  readonly rows: {
    readonly sources: Source[]
    readonly chunks: Chunk[]
    readonly paths: LearningPath[]
    readonly versions: PathVersion[]
    readonly runs: GenerationRun[]
    readonly extractions: Extraction[]
  }
  /** How many times `transaction` ran. */
  transactions(): number
}

export function createMemoryRepos(
  clock: Clock,
  seed: { readonly sources?: readonly Source[]; readonly chunks?: readonly Chunk[] } = {},
): MemoryRepos {
  const ids = createUuidV7Generator(clock)
  const rows = {
    sources: [...(seed.sources ?? [])],
    chunks: [...(seed.chunks ?? [])],
    paths: [] as LearningPath[],
    versions: [] as PathVersion[],
    runs: [] as GenerationRun[],
    extractions: [] as Extraction[],
  }
  let transactions = 0

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

  const patchRow = <T extends { id: string; updatedAt: Date; version: number }>(
    list: T[],
    id: string,
    patch: object,
    what: string,
  ): T => {
    const index = list.findIndex((row) => row.id === id)
    const current = list[index]
    if (current === undefined) throw new Error(`no ${what} ${id}`)
    const next = { ...current, ...patch, updatedAt: clock.now(), version: current.version + 1 }
    list[index] = next
    return next
  }

  const live = <T extends { deletedAt: Date | null }>(list: readonly T[]): T[] =>
    list.filter((row) => row.deletedAt === null)

  const repos: MemoryRepos = {
    rows,
    transactions: () => transactions,

    sources: {
      findMany: async (sourceIds) =>
        live(rows.sources).filter((source) => sourceIds.includes(source.id)),
    },

    chunks: {
      listBySource: async (sourceId) =>
        live(rows.chunks)
          .filter((chunk) => chunk.sourceId === sourceId)
          .sort((a, b) => a.ordinal - b.ordinal),
    },

    paths: {
      findById: async (id) => live(rows.paths).find((path) => path.id === id),
      create: async (input: NewEntity<LearningPath>) => {
        const row = audit(input)
        rows.paths.push(row)
        return row
      },
      update: async (id, patch: EntityPatch<LearningPath>) =>
        patchRow(rows.paths, id, patch, 'path'),
      createVersion: async (input) => {
        const number =
          input.number ??
          rows.versions.filter((version) => version.pathId === input.pathId).length + 1
        const row = audit({ ...input, number })
        rows.versions.push(row)
        return row
      },
      findVersion: async (id) => rows.versions.find((version) => version.id === id),
    },

    generationRuns: {
      findById: async (id) => live(rows.runs).find((run) => run.id === id),
      create: async (input: NewEntity<GenerationRun>) => {
        const row = audit(input)
        rows.runs.push(row)
        return row
      },
      update: async (id, patch: EntityPatch<GenerationRun>) =>
        patchRow(rows.runs, id, patch, 'generation run'),
      listActive: async () =>
        live(rows.runs).filter((run) => !['completed', 'failed', 'cancelled'].includes(run.status)),
      findLatestByPath: async (pathId) =>
        live(rows.runs)
          .filter((run) => run.pathId === pathId)
          .at(-1),
    },

    extractions: {
      findByCustomIds: async (customIds) => {
        const wanted = new Set(customIds)
        return live(rows.extractions).filter((row) => wanted.has(row.customId))
      },
      put: async (input: NewEntity<Extraction>) => {
        const index = rows.extractions.findIndex(
          (row) => row.customId === input.customId && row.deletedAt === null,
        )
        if (index >= 0) {
          const current = rows.extractions[index] as Extraction
          const next = {
            ...current,
            ...input,
            id: current.id,
            updatedAt: clock.now(),
            version: current.version + 1,
          }
          rows.extractions[index] = next
          return next
        }
        const row = audit(input)
        rows.extractions.push(row)
        return row
      },
    },

    transaction: async (work) => {
      transactions += 1
      return work(repos)
    },
  }

  return repos
}
