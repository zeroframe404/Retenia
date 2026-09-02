import type { OutboxEntry, OutboxRepository } from '@retenia/core'
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import { outbox } from '../schema'
import type { Row } from './base'
import { auditValues, type RepositoryContext } from './context'
import { mapConstraintErrors } from './errors'
import { toDate, toDateOrNull, toJsonObjectOrNull, toNumber, toText, toTextOrNull } from './mapping'

/**
 * The sync change log.
 *
 * Deliberately **not** built on `createBaseRepository`: every write there appends an outbox
 * row, so an outbox repository built on it would feed itself. Marking an entry synced must
 * not enqueue another entry either, so those writes go straight to the table.
 */
function toEntity(row: Row): OutboxEntry {
  return {
    id: toText(row.id),
    tableName: toText(row.tableName),
    rowId: toText(row.rowId),
    op: row.op as OutboxEntry['op'],
    rowVersion: toNumber(row.rowVersion),
    payload: toJsonObjectOrNull(row.payload),
    syncedAt: toDateOrNull(row.syncedAt),
    attempts: toNumber(row.attempts),
    error: toTextOrNull(row.error),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }
}

export function createOutboxRepository(ctx: RepositoryContext): OutboxRepository {
  function insert(entry: Parameters<OutboxRepository['append']>[0], at: number): OutboxEntry {
    const rows = mapConstraintErrors('outbox', () =>
      ctx.db
        .insert(outbox)
        .values({
          id: ctx.ids.next(),
          tableName: entry.tableName,
          rowId: entry.rowId,
          op: entry.op,
          rowVersion: entry.rowVersion,
          payload: entry.payload ?? null,
          syncedAt: null,
          attempts: 0,
          error: null,
          ...auditValues(ctx, at),
        })
        .returning()
        .all(),
    ) as Row[]
    const row = rows[0]
    if (row === undefined) throw new Error('outbox: insert returned no row')
    return toEntity(row)
  }

  return {
    append: async (entry) => insert(entry, ctx.clock.now().getTime()),

    appendMany: async (entries) => {
      if (entries.length === 0) return []
      return ctx.run(async () => {
        const at = ctx.clock.now().getTime()
        return entries.map((entry) => insert(entry, at))
      })
    },

    listPending: async (options) => {
      let query = ctx.db
        .select()
        .from(outbox)
        .where(and(isNull(outbox.syncedAt), isNull(outbox.deletedAt)))
        .orderBy(asc(outbox.createdAt), asc(outbox.id))
        .$dynamic()
      if (options?.limit !== undefined) query = query.limit(options.limit)
      if (options?.offset !== undefined) query = query.offset(options.offset)
      return (query.all() as Row[]).map(toEntity)
    },

    listForRow: async (tableName, rowId, options) => {
      let query = ctx.db
        .select()
        .from(outbox)
        .where(and(eq(outbox.tableName, tableName), eq(outbox.rowId, rowId)))
        .orderBy(asc(outbox.createdAt), asc(outbox.id))
        .$dynamic()
      if (options?.limit !== undefined) query = query.limit(options.limit)
      return (query.all() as Row[]).map(toEntity)
    },

    countPending: async () => {
      const rows = ctx.db
        .select({ value: count() })
        .from(outbox)
        .where(and(isNull(outbox.syncedAt), isNull(outbox.deletedAt)))
        .all() as Array<{ value: number }>
      return rows[0]?.value ?? 0
    },

    markSynced: async (ids, at) => {
      if (ids.length === 0) return
      const now = at.getTime()
      ctx.db
        .update(outbox)
        .set({
          syncedAt: now,
          updatedAt: sql`max(${outbox.updatedAt}, ${now})`,
          version: sql`${outbox.version} + 1`,
        })
        .where(inArray(outbox.id, [...ids]))
        .run()
    },

    recordFailure: async (id, error) => {
      const now = ctx.clock.now().getTime()
      ctx.db
        .update(outbox)
        .set({
          error,
          attempts: sql`${outbox.attempts} + 1`,
          updatedAt: sql`max(${outbox.updatedAt}, ${now})`,
          version: sql`${outbox.version} + 1`,
        })
        .where(eq(outbox.id, id))
        .run()
    },
  }
}
