import type { AiResult, AiResultRepository, NewEntity } from '@retenia/core'
import { and, desc, eq, isNull, lt, type SQL, sql } from 'drizzle-orm'
import { aiResults } from '../schema'
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
 * `ai_results` — the answer store behind `docs/spec/04-path-generation.md` §7's idempotency
 * rule. See the table's own comment in `schema/system.ts` for why it is not `ai_calls`.
 */

const codec: TableCodec<
  AiResult,
  NewEntity<AiResult>,
  Partial<NewEntity<AiResult>> & { version?: number }
> = {
  table: aiResults,
  name: 'ai_results',
  toEntity: (row: Row): AiResult => ({
    id: toText(row.id),
    customId: toText(row.customId),
    stage: toText(row.stage),
    provider: toText(row.provider),
    model: toText(row.model),
    promptVersion: toTextOrNull(row.promptVersion),
    schemaVersion: toTextOrNull(row.schemaVersion),
    output: toText(row.output),
    costUsd: toNumber(row.costUsd),
    hits: toNumber(row.hits),
    lastHitAt: toDateOrNull(row.lastHitAt),
    meta: toJsonObjectOrNull(row.meta),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      customId: input.customId,
      stage: input.stage,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion ?? null,
      schemaVersion: input.schemaVersion ?? null,
      output: input.output,
      costUsd: input.costUsd,
      hits: input.hits,
      lastHitAt: input.lastHitAt ?? null,
      meta: input.meta ?? null,
    }),
  toUpdate: (patch) =>
    defined({
      customId: patch.customId,
      stage: patch.stage,
      provider: patch.provider,
      model: patch.model,
      promptVersion: patch.promptVersion,
      schemaVersion: patch.schemaVersion,
      output: patch.output,
      costUsd: patch.costUsd,
      hits: patch.hits,
      lastHitAt: patch.lastHitAt,
      meta: patch.meta,
    }),
}

export function createAiResultRepository(ctx: RepositoryContext): AiResultRepository {
  const base = createBaseRepository(ctx, codec)

  const live = (customId: string): SQL | undefined =>
    and(eq(aiResults.customId, customId), isNull(aiResults.deletedAt))

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

    findByCustomId: async (customId) => {
      const [row] = await base.findWhere(live(customId), { limit: 1 })
      if (row === undefined) return undefined

      // The hit is counted with a bare UPDATE rather than through `base.update`, on purpose.
      // Going through the write path would bump `version` and write an outbox row, which
      // would make reading the cache look like editing the answer — a sync layer would then
      // ship a "change" on every cache hit, and optimistic concurrency on the row would start
      // failing for readers. `hits` and `last_hit_at` are diagnostics about the row, not part
      // of its content, so they move underneath the audit columns and not through them.
      ctx.db
        .update(aiResults)
        .set({ hits: sql`${aiResults.hits} + 1`, lastHitAt: ctx.clock.now().getTime() })
        .where(eq(aiResults.id, row.id))
        .run()

      return { ...row, hits: row.hits + 1 }
    },

    put: async (input) => {
      // Replace rather than insert: `force` exists so a user can regenerate an answer they
      // did not like, and leaving the old one in place would serve it again on the next run.
      const [existing] = await base.findWhere(live(input.customId), { limit: 1 })
      return existing === undefined
        ? await base.create(input)
        : await base.update(existing.id, input)
    },

    listByStage: (stage, options) =>
      base.findWhere(eq(aiResults.stage, stage), {
        ...options,
        orderBy: [desc(aiResults.createdAt), desc(aiResults.id)],
      }),

    purge: async (query) => {
      const rows = await base.findWhere(
        and(
          query.stage === undefined ? undefined : eq(aiResults.stage, query.stage),
          query.promptVersion === undefined
            ? undefined
            : eq(aiResults.promptVersion, query.promptVersion),
          query.before === undefined ? undefined : lt(aiResults.createdAt, query.before.getTime()),
        ),
      )
      // One at a time through `softDelete`, so the audit columns and the outbox behave the
      // way they do for every other retirement in this codebase. A cache purge is rare and
      // user-initiated; a bulk UPDATE that skipped the write path would be a second way of
      // deleting a row, which is exactly what `createBaseRepository` exists to prevent.
      for (const row of rows) await base.softDelete(row.id)
      return rows.length
    },
  }
}
