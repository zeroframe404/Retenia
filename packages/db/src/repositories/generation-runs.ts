import type { GenerationRun, GenerationRunRepository, NewEntity } from '@retenia/core'
import { asc, desc, eq, notInArray } from 'drizzle-orm'
import { generationRuns } from '../schema'
import { createBaseRepository, type Row, type TableCodec } from './base'
import type { RepositoryContext } from './context'
import {
  defined,
  toDate,
  toDateOrNull,
  toJsonArray,
  toJsonObject,
  toJsonObjectOrNull,
  toNumber,
  toText,
  toTextOrNull,
} from './mapping'

/**
 * `generation_runs` — the ledger of "Generate with AI" runs (sub-phase 8.1). See the table's
 * own comment in `schema/generation.ts` for why the draft itself is not a table.
 */

/** Nothing more will happen to a run in one of these; `listActive` is everything else. */
const TERMINAL: readonly GenerationRun['status'][] = ['completed', 'failed', 'cancelled']

const codec: TableCodec<
  GenerationRun,
  NewEntity<GenerationRun>,
  Partial<NewEntity<GenerationRun>> & { version?: number }
> = {
  table: generationRuns,
  name: 'generation_runs',
  toEntity: (row: Row): GenerationRun => ({
    id: toText(row.id),
    pathId: toText(row.pathId),
    pathVersionId: toTextOrNull(row.pathVersionId),
    status: toText(row.status) as GenerationRun['status'],
    config: toJsonObject(row.config),
    configHash: toText(row.configHash),
    progress: toJsonObjectOrNull(row.progress),
    estimate: toJsonObjectOrNull(row.estimate),
    costUsd: toNumber(row.costUsd),
    inputTokens: toNumber(row.inputTokens),
    outputTokens: toNumber(row.outputTokens),
    cachedTokens: toNumber(row.cachedTokens),
    manifest: toJsonObjectOrNull(row.manifest),
    warnings: toJsonArray(row.warnings),
    error: toTextOrNull(row.error),
    startedAt: toDateOrNull(row.startedAt),
    finishedAt: toDateOrNull(row.finishedAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      pathId: input.pathId,
      pathVersionId: input.pathVersionId ?? null,
      status: input.status,
      config: input.config,
      configHash: input.configHash,
      progress: input.progress ?? null,
      estimate: input.estimate ?? null,
      costUsd: input.costUsd,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cachedTokens: input.cachedTokens,
      manifest: input.manifest ?? null,
      warnings: input.warnings,
      error: input.error ?? null,
      // `timestampColumn` is a bare `integer`: a `Date` becomes milliseconds here, as in
      // `ai-batches.ts`.
      startedAt: input.startedAt?.getTime() ?? null,
      finishedAt: input.finishedAt?.getTime() ?? null,
    }),
  toUpdate: (patch) =>
    defined({
      pathId: patch.pathId,
      pathVersionId: patch.pathVersionId,
      status: patch.status,
      config: patch.config,
      configHash: patch.configHash,
      progress: patch.progress,
      estimate: patch.estimate,
      costUsd: patch.costUsd,
      inputTokens: patch.inputTokens,
      outputTokens: patch.outputTokens,
      cachedTokens: patch.cachedTokens,
      manifest: patch.manifest,
      warnings: patch.warnings,
      error: patch.error,
      startedAt: patch.startedAt === undefined ? undefined : (patch.startedAt?.getTime() ?? null),
      finishedAt:
        patch.finishedAt === undefined ? undefined : (patch.finishedAt?.getTime() ?? null),
    }),
}

export function createGenerationRunRepository(ctx: RepositoryContext): GenerationRunRepository {
  const base = createBaseRepository(ctx, codec)

  const newestFirst = [desc(generationRuns.createdAt), desc(generationRuns.id)]

  return {
    findById: base.findById,
    findMany: base.findMany,
    list: base.list,
    count: base.count,
    create: base.create,
    update: base.update,
    save: base.save,
    softDelete: base.softDelete,
    restore: base.restore,

    listByPath: (pathId, options) =>
      base.findWhere(eq(generationRuns.pathId, pathId), { ...options, orderBy: newestFirst }),

    // Oldest first: a resumed app continues the run that has been waiting longest, which is
    // the order the user asked for them in.
    listActive: () =>
      base.findWhere(notInArray(generationRuns.status, [...TERMINAL]), {
        orderBy: [asc(generationRuns.createdAt), asc(generationRuns.id)],
      }),

    findLatestByPath: async (pathId) => {
      const [row] = await base.findWhere(eq(generationRuns.pathId, pathId), {
        limit: 1,
        orderBy: newestFirst,
      })
      return row
    },
  }
}
