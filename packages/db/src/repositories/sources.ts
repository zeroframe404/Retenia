import type { NewEntity, Source, SourceRepository, SourceStatus, SourceUnit } from '@retenia/core'
import { and, asc, eq, isNull } from 'drizzle-orm'
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
