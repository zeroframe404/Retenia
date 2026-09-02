import type { AiCall, AiCallRepository, CostQuery, NewEntity } from '@retenia/core'
import { and, asc, desc, eq, gte, isNull, lt, type SQL, sql, sum } from 'drizzle-orm'
import { aiCalls } from '../schema'
import { createBaseRepository, type Row, type TableCodec } from './base'
import type { RepositoryContext } from './context'
import {
  defined,
  toDate,
  toDateOrNull,
  toJsonObjectOrNull,
  toNumber,
  toNumberOrNull,
  toText,
  toTextOrNull,
} from './mapping'

const codec: TableCodec<
  AiCall,
  NewEntity<AiCall>,
  Partial<NewEntity<AiCall>> & { version?: number }
> = {
  table: aiCalls,
  name: 'ai_calls',
  toEntity: (row: Row): AiCall => ({
    id: toText(row.id),
    provider: toText(row.provider),
    model: toText(row.model),
    role: toTextOrNull(row.role),
    purpose: toText(row.purpose),
    status: row.status as AiCall['status'],
    inputTokens: toNumber(row.inputTokens),
    outputTokens: toNumber(row.outputTokens),
    cachedInputTokens: toNumber(row.cachedInputTokens),
    reasoningTokens: toNumber(row.reasoningTokens),
    costUsd: toNumber(row.costUsd),
    latencyMs: toNumberOrNull(row.latencyMs),
    batchId: toTextOrNull(row.batchId),
    customId: toTextOrNull(row.customId),
    promptVersion: toTextOrNull(row.promptVersion),
    schemaVersion: toTextOrNull(row.schemaVersion),
    temperature: toNumberOrNull(row.temperature),
    jobId: toTextOrNull(row.jobId),
    error: toTextOrNull(row.error),
    meta: toJsonObjectOrNull(row.meta),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      provider: input.provider,
      model: input.model,
      role: input.role ?? null,
      purpose: input.purpose,
      status: input.status,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cachedInputTokens: input.cachedInputTokens,
      reasoningTokens: input.reasoningTokens,
      costUsd: input.costUsd,
      latencyMs: input.latencyMs ?? null,
      batchId: input.batchId ?? null,
      customId: input.customId ?? null,
      promptVersion: input.promptVersion ?? null,
      schemaVersion: input.schemaVersion ?? null,
      temperature: input.temperature ?? null,
      jobId: input.jobId ?? null,
      error: input.error ?? null,
      meta: input.meta ?? null,
    }),
  toUpdate: (patch) =>
    defined({
      provider: patch.provider,
      model: patch.model,
      role: patch.role,
      purpose: patch.purpose,
      status: patch.status,
      inputTokens: patch.inputTokens,
      outputTokens: patch.outputTokens,
      cachedInputTokens: patch.cachedInputTokens,
      reasoningTokens: patch.reasoningTokens,
      costUsd: patch.costUsd,
      latencyMs: patch.latencyMs,
      batchId: patch.batchId,
      customId: patch.customId,
      promptVersion: patch.promptVersion,
      schemaVersion: patch.schemaVersion,
      temperature: patch.temperature,
      jobId: patch.jobId,
      error: patch.error,
      meta: patch.meta,
    }),
}

export function createAiCallRepository(ctx: RepositoryContext): AiCallRepository {
  const base = createBaseRepository(ctx, codec)

  function costPredicate(query: CostQuery): SQL | undefined {
    return and(
      isNull(aiCalls.deletedAt),
      gte(aiCalls.createdAt, query.from.getTime()),
      query.to === undefined ? undefined : lt(aiCalls.createdAt, query.to.getTime()),
      query.provider === undefined ? undefined : eq(aiCalls.provider, query.provider),
      query.model === undefined ? undefined : eq(aiCalls.model, query.model),
      query.purpose === undefined ? undefined : eq(aiCalls.purpose, query.purpose),
    )
  }

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

    record: base.create,

    findByCustomId: async (customId) => (await base.findWhere(eq(aiCalls.customId, customId)))[0],

    listByBatch: (batchId, options) =>
      base.findWhere(eq(aiCalls.batchId, batchId), {
        ...options,
        orderBy: [asc(aiCalls.createdAt), asc(aiCalls.id)],
      }),

    listRecent: (options) =>
      base.findWhere(undefined, {
        ...options,
        orderBy: [desc(aiCalls.createdAt), desc(aiCalls.id)],
      }),

    sumCost: async (query) => {
      const rows = ctx.db
        .select({ total: sum(aiCalls.costUsd) })
        .from(aiCalls)
        .where(costPredicate(query))
        .all() as Array<{ total: string | number | null }>
      return Number(rows[0]?.total ?? 0)
    },

    costByModel: async (query) => {
      const rows = ctx.db
        .select({
          provider: aiCalls.provider,
          model: aiCalls.model,
          costUsd: sql<number>`sum(${aiCalls.costUsd})`,
        })
        .from(aiCalls)
        .where(costPredicate(query))
        .groupBy(aiCalls.provider, aiCalls.model)
        .orderBy(desc(sql`sum(${aiCalls.costUsd})`))
        .all() as Array<{ provider: string; model: string; costUsd: number }>
      return rows.map((row) => ({ ...row, costUsd: Number(row.costUsd) }))
    },
  }
}
