import type { AiBatch, AiBatchRepository, NewEntity } from '@retenia/core'
import { asc, desc, eq, notInArray } from 'drizzle-orm'
import { aiBatches } from '../schema'
import { createBaseRepository, type Row, type TableCodec } from './base'
import type { RepositoryContext } from './context'
import {
  defined,
  toDate,
  toDateOrNull,
  toJsonObjectOrNull,
  toNumber,
  toText,
  toTextOrNull,
} from './mapping'

/**
 * `ai_batches` — submitted Batch API jobs, so polling survives a restart (sub-phase 7.3).
 *
 * See the table's own comment in `schema/system.ts` for why it is a third table beside
 * `ai_calls` and `ai_results`, and for what it deliberately does not store.
 */

/** Nothing more will happen to a batch in one of these; `listActive` is everything else. */
const TERMINAL: readonly AiBatch['status'][] = ['completed', 'failed', 'cancelled']

const codec: TableCodec<
  AiBatch,
  NewEntity<AiBatch>,
  Partial<NewEntity<AiBatch>> & { version?: number }
> = {
  table: aiBatches,
  name: 'ai_batches',
  toEntity: (row: Row): AiBatch => ({
    id: toText(row.id),
    provider: toText(row.provider),
    model: toText(row.model),
    role: toText(row.role),
    purpose: toText(row.purpose),
    stage: toText(row.stage),
    status: toText(row.status) as AiBatch['status'],
    providerBatchId: toTextOrNull(row.providerBatchId),
    requestCount: toNumber(row.requestCount),
    succeededCount: toNumber(row.succeededCount),
    failedCount: toNumber(row.failedCount),
    costEstimateUsd: toNumber(row.costEstimateUsd),
    costUsd: toNumber(row.costUsd),
    attempts: toNumber(row.attempts),
    submittedAt: toDateOrNull(row.submittedAt),
    nextPollAt: toDateOrNull(row.nextPollAt),
    completedAt: toDateOrNull(row.completedAt),
    promptVersion: toTextOrNull(row.promptVersion),
    schemaVersion: toTextOrNull(row.schemaVersion),
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
      role: input.role,
      purpose: input.purpose,
      stage: input.stage,
      status: input.status,
      providerBatchId: input.providerBatchId ?? null,
      requestCount: input.requestCount,
      succeededCount: input.succeededCount,
      failedCount: input.failedCount,
      costEstimateUsd: input.costEstimateUsd,
      costUsd: input.costUsd,
      attempts: input.attempts,
      // `timestampColumn` is a bare `integer`, so a `Date` has to become milliseconds here —
      // the same conversion `jobs.ts` does for `run_after` and the lease columns.
      submittedAt: input.submittedAt?.getTime() ?? null,
      nextPollAt: input.nextPollAt?.getTime() ?? null,
      completedAt: input.completedAt?.getTime() ?? null,
      promptVersion: input.promptVersion ?? null,
      schemaVersion: input.schemaVersion ?? null,
      error: input.error ?? null,
      meta: input.meta ?? null,
    }),
  toUpdate: (patch) =>
    defined({
      provider: patch.provider,
      model: patch.model,
      role: patch.role,
      purpose: patch.purpose,
      stage: patch.stage,
      status: patch.status,
      providerBatchId: patch.providerBatchId,
      requestCount: patch.requestCount,
      succeededCount: patch.succeededCount,
      failedCount: patch.failedCount,
      costEstimateUsd: patch.costEstimateUsd,
      costUsd: patch.costUsd,
      attempts: patch.attempts,
      submittedAt:
        patch.submittedAt === undefined ? undefined : (patch.submittedAt?.getTime() ?? null),
      nextPollAt:
        patch.nextPollAt === undefined ? undefined : (patch.nextPollAt?.getTime() ?? null),
      completedAt:
        patch.completedAt === undefined ? undefined : (patch.completedAt?.getTime() ?? null),
      promptVersion: patch.promptVersion,
      schemaVersion: patch.schemaVersion,
      error: patch.error,
      meta: patch.meta,
    }),
}

export function createAiBatchRepository(ctx: RepositoryContext): AiBatchRepository {
  const base = createBaseRepository(ctx, codec)

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

    // Oldest first: a resumed run polls the batch that has been waiting longest before the
    // one submitted a minute ago, which is also the order they will finish in.
    listActive: () =>
      base.findWhere(notInArray(aiBatches.status, [...TERMINAL]), {
        orderBy: [asc(aiBatches.createdAt), asc(aiBatches.id)],
      }),

    listRecent: (options) =>
      base.findWhere(undefined, {
        ...options,
        orderBy: [desc(aiBatches.createdAt), desc(aiBatches.id)],
      }),

    findByProviderBatchId: async (providerBatchId) => {
      const [row] = await base.findWhere(eq(aiBatches.providerBatchId, providerBatchId), {
        limit: 1,
        orderBy: [desc(aiBatches.createdAt)],
      })
      return row
    },
  }
}
