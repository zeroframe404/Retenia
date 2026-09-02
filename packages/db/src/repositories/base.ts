import type { Entity, FindOptions, ListOptions } from '@retenia/core'
import { EntityNotFoundError, OptimisticConcurrencyError } from '@retenia/core'
import { and, asc, count, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { RepositoryContext } from './context'
import { mapConstraintErrors } from './errors'

/**
 * The half of every repository that is identical everywhere.
 *
 * Soft deletes, the `updated_at`/`version` bump and the outbox row live here and nowhere
 * else, so no concrete repository can forget them — that is the whole point of the factory.
 * A repository that needs a bespoke query composes this and adds its own methods; it never
 * reimplements the write path.
 */

/** Structural shape of any table built with `auditColumns()`. */
export interface AuditedTable extends SQLiteTable {
  id: SQLiteColumn
  createdAt: SQLiteColumn
  updatedAt: SQLiteColumn
  deletedAt: SQLiteColumn
  deviceId: SQLiteColumn
  version: SQLiteColumn
}

/** A raw row as the driver returns it, before the codec turns it into an entity. */
export type Row = Record<string, unknown>

/** Column values, as the driver wants them: numbers for timestamps, 0/1 for booleans. */
export type ColumnValues = Record<string, unknown>

export interface TableCodec<TEntity extends Entity, TCreate, TPatch> {
  readonly table: AuditedTable
  /** The SQL table name — also the `outbox.table_name` this repository writes. */
  readonly name: string
  toEntity(row: Row): TEntity
  /** Domain create input → columns. Must not produce `id` or any audit column. */
  toInsert(input: TCreate): ColumnValues
  /** Domain patch → columns. Must not produce `id` or any audit column. */
  toUpdate(patch: TPatch): ColumnValues
}

export interface UpdateOptions {
  /** Optimistic concurrency token. When given, the update fails if the row has moved on. */
  expectedVersion?: number
}

export interface BaseRepository<TEntity extends Entity, TCreate, TPatch> {
  readonly codec: TableCodec<TEntity, TCreate, TPatch>
  findById(id: string, options?: FindOptions): Promise<TEntity | undefined>
  findMany(ids: readonly string[], options?: FindOptions): Promise<TEntity[]>
  list(options?: ListOptions): Promise<TEntity[]>
  count(options?: Pick<ListOptions, 'includeDeleted'>): Promise<number>
  create(input: TCreate & { id?: string }): Promise<TEntity>
  createMany(inputs: readonly (TCreate & { id?: string })[]): Promise<TEntity[]>
  update(id: string, patch: TPatch & { version?: number }): Promise<TEntity>
  /** Insert when the id is unknown to the table, update when it is known. */
  save(entity: TCreate & { id: string; version?: number }): Promise<TEntity>
  softDelete(id: string): Promise<void>
  restore(id: string): Promise<void>
  /** Rows matching an arbitrary predicate, live only unless `includeDeleted`. */
  findWhere(where: SQL | undefined, options?: ListOptions & { orderBy?: SQL[] }): Promise<TEntity[]>
  /** The bespoke-query escape hatch: same audit/outbox handling, caller-chosen columns. */
  updateColumns(id: string, values: ColumnValues, options?: UpdateOptions): Promise<TEntity>
}

/** `deleted_at IS NULL`, unless the caller asked for the tombstones too. */
function liveOnly(table: AuditedTable, includeDeleted?: boolean): SQL | undefined {
  return includeDeleted === true ? undefined : isNull(table.deletedAt)
}

export function createBaseRepository<TEntity extends Entity, TCreate, TPatch>(
  ctx: RepositoryContext,
  codec: TableCodec<TEntity, TCreate, TPatch>,
): BaseRepository<TEntity, TCreate, TPatch> {
  const { table, name } = codec

  function nowMs(): number {
    return ctx.clock.now().getTime()
  }

  function selectRows(where: SQL | undefined, options?: ListOptions & { orderBy?: SQL[] }): Row[] {
    let query = ctx.db.select().from(table).$dynamic()
    if (where !== undefined) query = query.where(where)
    query = query.orderBy(...(options?.orderBy ?? [asc(table.id)]))
    if (options?.limit !== undefined) query = query.limit(options.limit)
    if (options?.offset !== undefined) query = query.offset(options.offset)
    return query.all() as Row[]
  }

  /** Only called when an update matched nothing: works out whether the row is missing or
   *  whether someone else wrote first, so the caller gets the right error. */
  function explainMissingRow(id: string, expectedVersion?: number): Error {
    const rows = ctx.db
      .select({ version: table.version, deletedAt: table.deletedAt })
      .from(table)
      .where(eq(table.id, id))
      .all() as Array<{ version: number; deletedAt: number | null }>
    const existing = rows[0]
    if (existing === undefined || existing.deletedAt !== null) {
      return new EntityNotFoundError(name, id)
    }
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      return new OptimisticConcurrencyError(name, id, expectedVersion, existing.version)
    }
    return new EntityNotFoundError(name, id)
  }

  function insertRow(input: TCreate & { id?: string }, at: number): Row {
    const values: ColumnValues = {
      ...codec.toInsert(input),
      id: input.id ?? ctx.ids.next(),
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      deviceId: ctx.deviceId,
      version: 1,
    }
    const rows = mapConstraintErrors(name, () =>
      ctx.db
        .insert(table)
        .values(values as never)
        .returning()
        .all(),
    ) as Row[]
    const row = rows[0]
    if (row === undefined) throw new Error(`${name}: insert returned no row`)
    ctx.outbox.append('insert', name, row as unknown as { id: string; version: number })
    return row
  }

  /**
   * The one write path for updates. `max(updated_at, :now)` keeps the standard
   * `updated_at >= created_at` CHECK true — and `updated_at` monotonic for a future sync —
   * even if the system clock steps backwards between two writes. `RETURNING` hands back the
   * post-image in the same statement, so the outbox records the version the row actually
   * has, with no second read and no race.
   */
  function updateRow(id: string, values: ColumnValues, options: UpdateOptions = {}): Row {
    const at = nowMs()
    const predicates: Array<SQL | undefined> = [eq(table.id, id), isNull(table.deletedAt)]
    if (options.expectedVersion !== undefined) {
      predicates.push(eq(table.version, options.expectedVersion))
    }
    const rows = mapConstraintErrors(name, () =>
      ctx.db
        .update(table)
        .set({
          ...values,
          updatedAt: sql`max(${table.updatedAt}, ${at})`,
          deviceId: ctx.deviceId,
          version: sql`${table.version} + 1`,
        } as never)
        .where(and(...predicates))
        .returning()
        .all(),
    ) as Row[]
    const row = rows[0]
    if (row === undefined) throw explainMissingRow(id, options.expectedVersion)
    ctx.outbox.append('update', name, row as unknown as { id: string; version: number })
    return row
  }

  return {
    codec,

    findById: async (id, options) => {
      const rows = selectRows(and(eq(table.id, id), liveOnly(table, options?.includeDeleted)))
      const row = rows[0]
      return row === undefined ? undefined : codec.toEntity(row)
    },

    findMany: async (ids, options) => {
      if (ids.length === 0) return []
      const rows = selectRows(
        and(inArray(table.id, [...ids]), liveOnly(table, options?.includeDeleted)),
      )
      return rows.map(codec.toEntity)
    },

    list: async (options) =>
      selectRows(liveOnly(table, options?.includeDeleted), options).map(codec.toEntity),

    count: async (options) => {
      const rows = ctx.db
        .select({ value: count() })
        .from(table)
        .where(liveOnly(table, options?.includeDeleted))
        .all() as Array<{ value: number }>
      return rows[0]?.value ?? 0
    },

    findWhere: async (where, options) =>
      selectRows(and(where, liveOnly(table, options?.includeDeleted)), options).map(codec.toEntity),

    create: async (input) => codec.toEntity(insertRow(input, nowMs())),

    createMany: async (inputs) => {
      if (inputs.length === 0) return []
      return ctx.run(async () => {
        const at = nowMs()
        return inputs.map((input) => codec.toEntity(insertRow(input, at)))
      })
    },

    update: async (id, patch) =>
      codec.toEntity(updateRow(id, codec.toUpdate(patch), { expectedVersion: patch.version })),

    updateColumns: async (id, values, options) => codec.toEntity(updateRow(id, values, options)),

    save: async (entity) =>
      ctx.run(async () => {
        const existing = ctx.db
          .select({ id: table.id, deletedAt: table.deletedAt })
          .from(table)
          .where(eq(table.id, entity.id))
          .all() as Array<{ id: string; deletedAt: number | null }>
        if (existing.length === 0) return codec.toEntity(insertRow(entity, nowMs()))
        return codec.toEntity(
          updateRow(entity.id, codec.toInsert(entity), { expectedVersion: entity.version }),
        )
      }),

    softDelete: async (id) => {
      const at = nowMs()
      const rows = ctx.db
        .update(table)
        .set({
          deletedAt: at,
          updatedAt: sql`max(${table.updatedAt}, ${at})`,
          deviceId: ctx.deviceId,
          version: sql`${table.version} + 1`,
        } as never)
        .where(and(eq(table.id, id), isNull(table.deletedAt)))
        .returning()
        .all() as Row[]
      const row = rows[0]
      // Soft-deleting an already-deleted (or unknown) row is a no-op, not an error.
      if (row !== undefined) {
        ctx.outbox.append('delete', name, row as unknown as { id: string; version: number })
      }
    },

    restore: async (id) => {
      const at = nowMs()
      const rows = ctx.db
        .update(table)
        .set({
          deletedAt: null,
          updatedAt: sql`max(${table.updatedAt}, ${at})`,
          deviceId: ctx.deviceId,
          version: sql`${table.version} + 1`,
        } as never)
        .where(and(eq(table.id, id), sql`${table.deletedAt} is not null`))
        .returning()
        .all() as Row[]
      const row = rows[0]
      if (row !== undefined) {
        ctx.outbox.append('update', name, row as unknown as { id: string; version: number })
      }
    },
  }
}
