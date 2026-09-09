import type { Extraction, ExtractionRepository, NewEntity } from '@retenia/core'
import { asc, eq, inArray } from 'drizzle-orm'
import { extractions } from '../schema'
import { createBaseRepository, type Row, type TableCodec } from './base'
import type { RepositoryContext } from './context'
import {
  defined,
  toDate,
  toDateOrNull,
  toJsonObject,
  toNumber,
  toText,
  toTextOrNull,
} from './mapping'

/**
 * `extractions` — the validated P1 output per chunk (sub-phase 8.1). See the table's own
 * comment in `schema/generation.ts` for why it exists beside `ai_results`.
 */

/**
 * How many ids one `IN (…)` carries. SQLite's bound-parameter ceiling is 999 on older
 * builds and 32,766 on the one shipped here; a 300-page book is ~180 chunks, so this is
 * rarely more than one statement and never a failing one.
 */
const IN_SLICE = 500

function slices<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let start = 0; start < items.length; start += IN_SLICE) {
    out.push(items.slice(start, start + IN_SLICE))
  }
  return out
}

const codec: TableCodec<
  Extraction,
  NewEntity<Extraction>,
  Partial<NewEntity<Extraction>> & { version?: number }
> = {
  table: extractions,
  name: 'extractions',
  toEntity: (row: Row): Extraction => ({
    id: toText(row.id),
    runId: toText(row.runId),
    sourceId: toText(row.sourceId),
    chunkId: toText(row.chunkId),
    chunkKey: toTextOrNull(row.chunkKey),
    chunkHash: toText(row.chunkHash),
    customId: toText(row.customId),
    promptVersion: toText(row.promptVersion),
    schemaVersion: toText(row.schemaVersion),
    provider: toTextOrNull(row.provider),
    model: toText(row.model),
    output: toJsonObject(row.output),
    conceptCount: toNumber(row.conceptCount),
    inputTokens: toNumber(row.inputTokens),
    outputTokens: toNumber(row.outputTokens),
    cachedTokens: toNumber(row.cachedTokens),
    costUsd: toNumber(row.costUsd),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      runId: input.runId,
      sourceId: input.sourceId,
      chunkId: input.chunkId,
      chunkKey: input.chunkKey ?? null,
      chunkHash: input.chunkHash,
      customId: input.customId,
      promptVersion: input.promptVersion,
      schemaVersion: input.schemaVersion,
      provider: input.provider ?? null,
      model: input.model,
      output: input.output,
      conceptCount: input.conceptCount,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cachedTokens: input.cachedTokens,
      costUsd: input.costUsd,
    }),
  toUpdate: (patch) =>
    defined({
      runId: patch.runId,
      sourceId: patch.sourceId,
      chunkId: patch.chunkId,
      chunkKey: patch.chunkKey,
      chunkHash: patch.chunkHash,
      customId: patch.customId,
      promptVersion: patch.promptVersion,
      schemaVersion: patch.schemaVersion,
      provider: patch.provider,
      model: patch.model,
      output: patch.output,
      conceptCount: patch.conceptCount,
      inputTokens: patch.inputTokens,
      outputTokens: patch.outputTokens,
      cachedTokens: patch.cachedTokens,
      costUsd: patch.costUsd,
    }),
}

export function createExtractionRepository(ctx: RepositoryContext): ExtractionRepository {
  const base = createBaseRepository(ctx, codec)

  const oldestFirst = [asc(extractions.createdAt), asc(extractions.id)]

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

    findByCustomIds: async (customIds) => {
      const out: Extraction[] = []
      for (const slice of slices([...new Set(customIds)])) {
        out.push(...(await base.findWhere(inArray(extractions.customId, slice))))
      }
      return out
    },

    listByChunkIds: async (chunkIds) => {
      const out: Extraction[] = []
      for (const slice of slices([...new Set(chunkIds)])) {
        out.push(
          ...(await base.findWhere(inArray(extractions.chunkId, slice), { orderBy: oldestFirst })),
        )
      }
      return out
    },

    listBySource: (sourceId, options) =>
      base.findWhere(eq(extractions.sourceId, sourceId), { ...options, orderBy: oldestFirst }),

    put: async (input) => {
      // Replace rather than insert, for the same reason `ai-results.ts` does: a forced
      // regeneration has to be able to replace the answer it deliberately bypassed, and the
      // live-unique index on `custom_id` would refuse a second row anyway.
      const [existing] = await base.findWhere(eq(extractions.customId, input.customId), {
        limit: 1,
      })
      return existing === undefined
        ? await base.create(input)
        : await base.update(existing.id, input)
    },
  }
}
