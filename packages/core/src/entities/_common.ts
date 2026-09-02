/**
 * Shapes shared by every entity in `@retenia/core`.
 *
 * These are the *domain* view of the rows described by `docs/spec/07a-schema.md`: camelCase
 * names, `Date` instead of Unix milliseconds, parsed objects instead of JSON `TEXT`. They
 * deliberately name no storage technology — a repository adapter (SQLite today, expo-sqlite
 * or PowerSync tomorrow) is what maps them to columns.
 */

/** Anything `JSON.stringify` accepts. Narrow it per field where the shape is known. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

/**
 * The sync-ready audit set every domain row carries (`docs/spec/00-conventions.md`).
 *
 * `deletedAt` is the only way a row disappears — nothing ever issues a hard delete (the one
 * exception is blob garbage collection, see `BlobRepository`). `version` starts at 1 and the
 * repository increments it on every update; with `deviceId` it is what a future sync layer
 * uses to detect conflicts.
 */
export interface AuditFields {
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  deviceId: string
  version: number
}

/** Every domain entity: a UUIDv7 id plus the audit set. */
export interface Entity extends AuditFields {
  id: string
}
