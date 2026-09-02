import { type SQL, sql } from 'drizzle-orm'
import { check, integer, type SQLiteColumn, text } from 'drizzle-orm/sqlite-core'

/**
 * Column and constraint helpers shared by every table in `packages/db/src/schema`.
 *
 * Conventions they encode (docs/spec/00-conventions.md, docs/spec/07-architecture.md §5):
 * - `id` is a UUIDv7 string, never autoincrement.
 * - every table carries `created_at`, `updated_at` (Unix ms), `deleted_at` (soft delete),
 *   `device_id` and `version` — the sync-ready audit set.
 * - JSON lives in `TEXT` columns guarded by `json_valid`.
 * - enumerations are `TEXT`/`INTEGER` columns guarded by `CHECK (… IN (…))`.
 */

/** Anything `JSON.stringify` accepts. Narrow per column with `.$type<…>()`. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

/** The five importance levels (docs/spec/02-memory-system.md §7). Natural key of
 * `importance_levels.name`, and the value of `knowledge_items.importance`. */
export const IMPORTANCE_LEVELS = ['urgent', 'high', 'normal', 'maintenance', 'paused'] as const
export type ImportanceLevel = (typeof IMPORTANCE_LEVELS)[number]

/** `id TEXT PRIMARY KEY` — a UUIDv7 produced by `@retenia/core`'s `createUuidV7Generator`. */
export function idColumn() {
  return text('id').primaryKey()
}

/**
 * The audit columns every domain table ends with. A factory rather than a shared object:
 * Drizzle column builders are stateful, so each table needs its own instances.
 *
 * `version` starts at 1 and is incremented by the repository on every update; a future
 * sync layer uses it (with `device_id`) to detect conflicts. `deleted_at` is the *only*
 * way a row disappears — nothing issues `DELETE` against these tables.
 */
export function auditColumns() {
  return {
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
    deviceId: text('device_id').notNull(),
    version: integer('version').notNull().default(1),
  }
}

/** A `TEXT` column holding JSON, transparently parsed/stringified by Drizzle. */
export function jsonColumn(name: string) {
  return text(name, { mode: 'json' })
}

/** A Unix-millisecond timestamp column. */
export function timestampColumn(name: string) {
  return integer(name)
}

/** A `0`/`1` boolean column. */
export function boolColumn(name: string) {
  return integer(name)
}

function quoteList(values: readonly string[]): SQL {
  return sql.raw(values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', '))
}

/** `CHECK (column IN ('a', 'b', …))`. */
export function inTextList(column: SQLiteColumn, values: readonly string[]): SQL {
  return sql`${column} IN (${quoteList(values)})`
}

/** `CHECK (column IS NULL OR column IN ('a', 'b', …))`. */
export function inTextListOrNull(column: SQLiteColumn, values: readonly string[]): SQL {
  return sql`${column} IS NULL OR ${column} IN (${quoteList(values)})`
}

/** `CHECK (column IN (0, 1, …))`. */
export function inIntList(column: SQLiteColumn, values: readonly number[]): SQL {
  return sql`${column} IN (${sql.raw(values.join(', '))})`
}

/** `CHECK (column IS NULL OR column IN (0, 1, …))`. */
export function inIntListOrNull(column: SQLiteColumn, values: readonly number[]): SQL {
  return sql`${column} IS NULL OR ${column} IN (${sql.raw(values.join(', '))})`
}

/** `CHECK (column IN (0, 1))` for boolean flags. */
export function isBool(column: SQLiteColumn): SQL {
  return sql`${column} IN (0, 1)`
}

/** `CHECK (json_valid(column))`, tolerating `NULL` on nullable columns. */
export function jsonValid(column: SQLiteColumn): SQL {
  return column.notNull
    ? sql`json_valid(${column})`
    : sql`${column} IS NULL OR json_valid(${column})`
}

/** `CHECK (json_type(column) = 'array')` (plus validity), tolerating `NULL` when nullable. */
export function jsonArray(column: SQLiteColumn): SQL {
  const valid = sql`json_valid(${column}) AND json_type(${column}) = 'array'`
  return column.notNull ? valid : sql`${column} IS NULL OR (${valid})`
}

/** `CHECK (json_type(column) = 'object')` (plus validity), tolerating `NULL` when nullable. */
export function jsonObject(column: SQLiteColumn): SQL {
  const valid = sql`json_valid(${column}) AND json_type(${column}) = 'object'`
  return column.notNull ? valid : sql`${column} IS NULL OR (${valid})`
}

/** `CHECK (min <= column <= max)`, tolerating `NULL` when nullable. */
export function inRange(column: SQLiteColumn, min: number, max: number): SQL {
  const bounded = sql`${column} >= ${sql.raw(String(min))} AND ${column} <= ${sql.raw(String(max))}`
  return column.notNull ? bounded : sql`${column} IS NULL OR (${bounded})`
}

/** `CHECK (column >= min)`, tolerating `NULL` when nullable. */
export function atLeast(column: SQLiteColumn, min: number): SQL {
  const bounded = sql`${column} >= ${sql.raw(String(min))}`
  return column.notNull ? bounded : sql`${column} IS NULL OR ${bounded}`
}

/** `WHERE deleted_at IS NULL` — the predicate of every "live rows only" partial index. */
export function notDeleted(table: { deletedAt: SQLiteColumn }): SQL {
  return sql`${table.deletedAt} IS NULL`
}

/**
 * The constraints every domain table carries, named `<table>_<rule>` so they read well
 * in `sqlite_master` and in the generated schema doc:
 * - `id` looks like a UUIDv7 (36 chars, version nibble `7`), which rejects v4 ids,
 *   autoincrement-style numbers and empty strings at the database boundary;
 * - `version` is at least 1;
 * - `updated_at` never precedes `created_at`.
 */
export function standardChecks(
  tableName: string,
  table: {
    id: SQLiteColumn
    createdAt: SQLiteColumn
    updatedAt: SQLiteColumn
    version: SQLiteColumn
  },
) {
  return [
    check(
      `${tableName}_id_uuidv7`,
      sql`length(${table.id}) = 36 AND substr(${table.id}, 15, 1) = '7'`,
    ),
    check(`${tableName}_version_positive`, sql`${table.version} >= 1`),
    check(`${tableName}_updated_after_created`, sql`${table.updatedAt} >= ${table.createdAt}`),
  ]
}
