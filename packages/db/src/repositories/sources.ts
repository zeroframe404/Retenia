import type {
  EmbeddingStatus,
  NewEntity,
  Source,
  SourceRepository,
  SourceStatus,
  SourceUnit,
} from '@retenia/core'
import { and, asc, desc, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { chunks, sources, sourceUnits } from '../schema'
import { type BaseRepository, createBaseRepository, type Row, type TableCodec } from './base'
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

type NewSource = NewEntity<Source>
type SourcePatch = Partial<NewSource> & { version?: number }
type NewSourceUnit = NewEntity<SourceUnit>
type SourceUnitPatch = Partial<NewSourceUnit> & { version?: number }

const sourceCodec: TableCodec<Source, NewSource, SourcePatch> = {
  table: sources,
  name: 'sources',
  toEntity: (row: Row): Source => ({
    id: toText(row.id),
    kind: row.kind as Source['kind'],
    title: toText(row.title),
    originUri: toTextOrNull(row.originUri),
    blobSha256: toTextOrNull(row.blobSha256),
    status: row.status as SourceStatus,
    language: toTextOrNull(row.language),
    meta: toJsonObjectOrNull(row.meta),
    error: toTextOrNull(row.error),
    ingestedAt: toDateOrNull(row.ingestedAt),
    embeddingStatus: row.embeddingStatus as EmbeddingStatus,
    embeddingModelId: toTextOrNull(row.embeddingModelId),
    embeddingError: toTextOrNull(row.embeddingError),
    lastLocator: toJsonObjectOrNull(row.lastLocator),
    lastOpenedAt: toDateOrNull(row.lastOpenedAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      kind: input.kind,
      title: input.title,
      originUri: input.originUri ?? null,
      blobSha256: input.blobSha256 ?? null,
      status: input.status,
      language: input.language ?? null,
      meta: input.meta ?? null,
      error: input.error ?? null,
      ingestedAt:
        input.ingestedAt === null || input.ingestedAt === undefined
          ? null
          : input.ingestedAt.getTime(),
      embeddingStatus: input.embeddingStatus,
      embeddingModelId: input.embeddingModelId ?? null,
      embeddingError: input.embeddingError ?? null,
      lastLocator: input.lastLocator ?? null,
      lastOpenedAt:
        input.lastOpenedAt === null || input.lastOpenedAt === undefined
          ? null
          : input.lastOpenedAt.getTime(),
    }),
  toUpdate: (patch) =>
    defined({
      kind: patch.kind,
      title: patch.title,
      originUri: patch.originUri,
      blobSha256: patch.blobSha256,
      status: patch.status,
      language: patch.language,
      meta: patch.meta,
      error: patch.error,
      ingestedAt:
        patch.ingestedAt === undefined ? undefined : (patch.ingestedAt?.getTime() ?? null),
      embeddingStatus: patch.embeddingStatus,
      embeddingModelId: patch.embeddingModelId,
      embeddingError: patch.embeddingError,
      lastLocator: patch.lastLocator,
      lastOpenedAt:
        patch.lastOpenedAt === undefined ? undefined : (patch.lastOpenedAt?.getTime() ?? null),
    }),
}

const unitCodec: TableCodec<SourceUnit, NewSourceUnit, SourceUnitPatch> = {
  table: sourceUnits,
  name: 'source_units',
  toEntity: (row: Row): SourceUnit => ({
    id: toText(row.id),
    sourceId: toText(row.sourceId),
    kind: row.kind as SourceUnit['kind'],
    ordinal: toNumber(row.ordinal),
    label: toTextOrNull(row.label),
    tStart: toNumberOrNull(row.tStart),
    tEnd: toNumberOrNull(row.tEnd),
    text: toTextOrNull(row.text),
    blobSha256: toTextOrNull(row.blobSha256),
    meta: toJsonObjectOrNull(row.meta),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      sourceId: input.sourceId,
      kind: input.kind,
      ordinal: input.ordinal,
      label: input.label ?? null,
      tStart: input.tStart ?? null,
      tEnd: input.tEnd ?? null,
      text: input.text ?? null,
      blobSha256: input.blobSha256 ?? null,
      meta: input.meta ?? null,
    }),
  toUpdate: (patch) =>
    defined({
      sourceId: patch.sourceId,
      kind: patch.kind,
      ordinal: patch.ordinal,
      label: patch.label,
      tStart: patch.tStart,
      tEnd: patch.tEnd,
      text: patch.text,
      blobSha256: patch.blobSha256,
      meta: patch.meta,
    }),
}

export function createSourceRepository(ctx: RepositoryContext): SourceRepository {
  const base: BaseRepository<Source, NewSource, SourcePatch> = createBaseRepository(
    ctx,
    sourceCodec,
  )
  const units: BaseRepository<SourceUnit, NewSourceUnit, SourceUnitPatch> = createBaseRepository(
    ctx,
    unitCodec,
  )

  /**
   * `sources_soft_delete_cascade` (migration `0001`) soft-deletes the source's units and
   * chunks *in SQL*, bumping their `version`. Those writes never pass through a repository,
   * so nothing would emit their outbox rows — a future sync would silently lose every chunk
   * of a deleted book. We cannot add a trigger (applied migrations are immutable), so the
   * repository reads back what the cascade touched and emits for it.
   */
  function emitCascade(sourceId: string, op: 'delete' | 'update', deletedAt: number): void {
    if (!ctx.outbox.enabled) return
    const touchedUnits = ctx.db
      .select({ id: sourceUnits.id, version: sourceUnits.version })
      .from(sourceUnits)
      .where(
        and(eq(sourceUnits.sourceId, sourceId), matchDeleted(op, deletedAt, sourceUnits.deletedAt)),
      )
      .all() as Array<{ id: string; version: number }>
    for (const row of touchedUnits) ctx.outbox.append(op, 'source_units', row)

    const touchedChunks = ctx.db
      .select({ id: chunks.id, version: chunks.version })
      .from(chunks)
      .where(and(eq(chunks.sourceId, sourceId), matchDeleted(op, deletedAt, chunks.deletedAt)))
      .all() as Array<{ id: string; version: number }>
    for (const row of touchedChunks) ctx.outbox.append(op, 'chunks', row)
  }

  /** After a soft delete the children carry the source's `deleted_at`; after a restore they
   *  are live again, so identify them by "not deleted" instead. */
  function matchDeleted(op: 'delete' | 'update', deletedAt: number, column: SQLiteColumn) {
    return op === 'delete' ? eq(column, deletedAt) : isNull(column)
  }

  return {
    findById: base.findById,
    findMany: base.findMany,
    list: base.list,
    count: base.count,
    create: base.create,
    update: base.update,
    save: base.save,

    softDelete: async (id) => {
      await ctx.run(async () => {
        const before = await base.findById(id)
        if (before === undefined) return
        await base.softDelete(id)
        const after = await base.findById(id, { includeDeleted: true })
        if (after?.deletedAt != null) emitCascade(id, 'delete', after.deletedAt.getTime())
      })
    },

    restore: async (id) => {
      await ctx.run(async () => {
        const before = await base.findById(id, { includeDeleted: true })
        if (before?.deletedAt == null) return
        const deletedAt = before.deletedAt.getTime()
        await base.restore(id)
        emitCascade(id, 'update', deletedAt)
      })
    },

    findByBlobSha256: async (sha256) => (await base.findWhere(eq(sources.blobSha256, sha256)))[0],

    listByStatus: (status, options) =>
      base.findWhere(eq(sources.status, status), {
        ...options,
        orderBy: [asc(sources.createdAt), asc(sources.id)],
      }),

    markIngested: (id, at) =>
      base.updateColumns(id, { status: 'ready', ingestedAt: at.getTime(), error: null }),

    markFailed: (id, message) => base.updateColumns(id, { status: 'failed', error: message }),

    setEmbeddingState: (id, state) =>
      base.updateColumns(id, {
        embeddingStatus: state.status,
        // `undefined` means "leave it"; `null` means "this source is in no space any more",
        // which is exactly what dropping its vectors for a reindex leaves behind.
        ...(state.modelId === undefined ? {} : { embeddingModelId: state.modelId }),
        // Cleared unless given: every transition out of `failed` makes the old reason wrong.
        embeddingError: state.error ?? null,
      }),

    sourceIdsNeedingEmbedding: async (modelId) => {
      // One query for the three populations §6.3 has to catch: never embedded, last run
      // failed, and embedded under another model. A source with no live chunks is excluded —
      // there is nothing to embed, and including it would make the sweep re-queue every
      // unparsed source on every start.
      const rows = ctx.db
        .select({ id: sources.id })
        .from(sources)
        .where(
          and(
            isNull(sources.deletedAt),
            or(
              ne(sources.embeddingStatus, 'ready'),
              isNull(sources.embeddingModelId),
              ne(sources.embeddingModelId, modelId),
            ),
            sql`EXISTS (SELECT 1 FROM ${chunks} WHERE ${chunks.sourceId} = ${sources.id} AND ${chunks.deletedAt} IS NULL)`,
          ),
        )
        .orderBy(asc(sources.createdAt), asc(sources.id))
        .all() as Array<{ id: string }>
      return rows.map((row) => row.id)
    },

    recordProgress: (id, locator, at) =>
      base.updateColumns(id, { lastLocator: locator, lastOpenedAt: at.getTime() }),

    listRecentlyOpened: (limit) =>
      base.findWhere(isNotNull(sources.lastOpenedAt), {
        limit,
        orderBy: [desc(sources.lastOpenedAt)],
      }),

    findUnit: units.findById,

    listUnits: (sourceId, options) =>
      units.findWhere(eq(sourceUnits.sourceId, sourceId), {
        ...options,
        orderBy: [asc(sourceUnits.ordinal), asc(sourceUnits.id)],
      }),

    createUnit: units.create,

    replaceUnits: async (sourceId, replacements) =>
      ctx.run(async () => {
        const existing = await units.findWhere(eq(sourceUnits.sourceId, sourceId))
        for (const unit of existing) await units.softDelete(unit.id)
        return units.createMany(replacements.map((unit) => ({ ...unit, sourceId })))
      }),
  }
}
