import type {
  ImportanceLevel,
  KnowledgeItem,
  KnowledgeItemRepository,
  KnowledgeItemStatus,
  ListOptions,
  NewEntity,
} from '@retenia/core'
import { asc, count, eq, isNull } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { knowledgeItems } from '../schema'
import { type BaseRepository, createBaseRepository, type Row, type TableCodec } from './base'
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

type NewKnowledgeItem = NewEntity<KnowledgeItem>
type KnowledgeItemPatch = Partial<NewKnowledgeItem> & { version?: number }

const codec: TableCodec<KnowledgeItem, NewKnowledgeItem, KnowledgeItemPatch> = {
  table: knowledgeItems,
  name: 'knowledge_items',
  toEntity: (row: Row): KnowledgeItem => ({
    id: toText(row.id),
    lessonId: toTextOrNull(row.lessonId),
    topicId: toTextOrNull(row.topicId),
    kind: row.kind as KnowledgeItem['kind'],
    fields: toJsonObject(row.fields),
    sourceId: toTextOrNull(row.sourceId),
    annotationId: toTextOrNull(row.annotationId),
    locator: toJsonObjectOrNull(row.locator),
    asOf: toTextOrNull(row.asOf),
    importance: row.importance as ImportanceLevel,
    status: row.status as KnowledgeItemStatus,
    createdBy: row.createdBy as KnowledgeItem['createdBy'],
    tags: toJsonArray(row.tags),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      lessonId: input.lessonId ?? null,
      topicId: input.topicId ?? null,
      kind: input.kind,
      fields: input.fields,
      sourceId: input.sourceId ?? null,
      annotationId: input.annotationId ?? null,
      locator: input.locator ?? null,
      asOf: input.asOf ?? null,
      importance: input.importance,
      status: input.status,
      createdBy: input.createdBy,
      tags: input.tags,
    }),
  toUpdate: (patch) =>
    defined({
      lessonId: patch.lessonId,
      topicId: patch.topicId,
      kind: patch.kind,
      fields: patch.fields,
      sourceId: patch.sourceId,
      annotationId: patch.annotationId,
      locator: patch.locator,
      asOf: patch.asOf,
      importance: patch.importance,
      status: patch.status,
      createdBy: patch.createdBy,
      tags: patch.tags,
    }),
}

export function createKnowledgeItemRepository(ctx: RepositoryContext): KnowledgeItemRepository {
  const base: BaseRepository<KnowledgeItem, NewKnowledgeItem, KnowledgeItemPatch> =
    createBaseRepository(ctx, codec)

  const byColumn = (
    column: SQLiteColumn,
    value: string,
    options?: ListOptions,
  ): Promise<KnowledgeItem[]> =>
    base.findWhere(eq(column, value), { ...options, orderBy: [asc(knowledgeItems.createdAt)] })

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

    listByLesson: (lessonId, options) => byColumn(knowledgeItems.lessonId, lessonId, options),
    listBySource: (sourceId, options) => byColumn(knowledgeItems.sourceId, sourceId, options),
    listByAnnotation: (annotationId, options) =>
      byColumn(knowledgeItems.annotationId, annotationId, options),
    listByTopic: (topicId, options) => byColumn(knowledgeItems.topicId, topicId, options),

    setImportance: (id, importance) => base.update(id, { importance }),

    countByStatus: async () => {
      const rows = ctx.db
        .select({ status: knowledgeItems.status, value: count() })
        .from(knowledgeItems)
        .where(isNull(knowledgeItems.deletedAt))
        .groupBy(knowledgeItems.status)
        .all() as Array<{ status: KnowledgeItemStatus; value: number }>
      const totals: Record<KnowledgeItemStatus, number> = {
        need_to_learn: 0,
        active: 0,
        archived: 0,
      }
      for (const row of rows) totals[row.status] = row.value
      return totals
    },
  }
}
