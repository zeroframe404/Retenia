import type {
  Annotation,
  AnnotationKind,
  AnnotationRepository,
  ListOptions,
  NewEntity,
} from '@retenia/core'
import { asc, eq } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { annotations } from '../schema'
import { type BaseRepository, createBaseRepository, type Row, type TableCodec } from './base'
import type { RepositoryContext } from './context'
import {
  defined,
  toDate,
  toDateOrNull,
  toJsonObject,
  toNumber,
  toNumberOrNull,
  toText,
  toTextOrNull,
} from './mapping'

type NewAnnotation = NewEntity<Annotation>
type AnnotationPatch = Partial<NewAnnotation> & { version?: number }

const codec: TableCodec<Annotation, NewAnnotation, AnnotationPatch> = {
  table: annotations,
  name: 'annotations',
  toEntity: (row: Row): Annotation => ({
    id: toText(row.id),
    sourceId: toText(row.sourceId),
    unitId: toTextOrNull(row.unitId),
    kind: row.kind as AnnotationKind,
    anchor: toJsonObject(row.anchor),
    quote: toTextOrNull(row.quote),
    note: toTextOrNull(row.note),
    color: toTextOrNull(row.color),
    tStart: toNumberOrNull(row.tStart),
    tEnd: toNumberOrNull(row.tEnd),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      sourceId: input.sourceId,
      unitId: input.unitId ?? null,
      kind: input.kind,
      anchor: input.anchor,
      quote: input.quote ?? null,
      note: input.note ?? null,
      color: input.color ?? null,
      tStart: input.tStart ?? null,
      tEnd: input.tEnd ?? null,
    }),
  toUpdate: (patch) =>
    defined({
      sourceId: patch.sourceId,
      unitId: patch.unitId,
      kind: patch.kind,
      anchor: patch.anchor,
      quote: patch.quote,
      note: patch.note,
      color: patch.color,
      tStart: patch.tStart,
      tEnd: patch.tEnd,
    }),
}

export function createAnnotationRepository(ctx: RepositoryContext): AnnotationRepository {
  const base: BaseRepository<Annotation, NewAnnotation, AnnotationPatch> = createBaseRepository(
    ctx,
    codec,
  )

  const byColumn = (
    column: SQLiteColumn,
    value: string,
    options?: ListOptions,
  ): Promise<Annotation[]> =>
    base.findWhere(eq(column, value), { ...options, orderBy: [asc(annotations.createdAt)] })

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

    listBySource: (sourceId, options) => byColumn(annotations.sourceId, sourceId, options),
    listByUnit: (unitId, options) => byColumn(annotations.unitId, unitId, options),
  }
}
