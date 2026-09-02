import type { AuditFields, Entity } from '../entities'

/**
 * The shapes every repository port speaks, and the one CRUD contract they all extend.
 *
 * Repositories own the audit set: a caller never writes `createdAt`, `updatedAt`,
 * `deletedAt`, `deviceId` or `version` by hand. That is what makes "soft delete only" and
 * "`version` bumps on every update" enforceable rather than a convention.
 */

/** What a caller supplies to create a row: everything but the audit set, with an optional
 *  id (the repository mints a UUIDv7 when it is absent). */
export type NewEntity<T extends Entity> = Omit<T, keyof AuditFields | 'id'> & { id?: string }

/** What a caller supplies to update a row. `version`, when given, is an optimistic
 *  concurrency token: the update fails if the stored row has moved on. */
export type EntityPatch<T extends Entity> = Partial<Omit<T, 'id' | keyof AuditFields>> & {
  version?: number
}

/** `NewEntity` plus a required id — an upsert's payload. */
export type SaveEntity<T extends Entity> = NewEntity<T> & { id: string }

export interface ListOptions {
  limit?: number
  offset?: number
  /** Include soft-deleted rows. Off everywhere by default. */
  includeDeleted?: boolean
}

export interface FindOptions {
  includeDeleted?: boolean
}

/** The half of every repository that is the same everywhere. Ports extend it with the
 *  queries their aggregate actually needs. */
export interface CrudRepository<T extends Entity> {
  findById(id: string, options?: FindOptions): Promise<T | undefined>
  findMany(ids: readonly string[], options?: FindOptions): Promise<T[]>
  list(options?: ListOptions): Promise<T[]>
  count(options?: Pick<ListOptions, 'includeDeleted'>): Promise<number>
  create(input: NewEntity<T>): Promise<T>
  update(id: string, patch: EntityPatch<T>): Promise<T>
  /** Insert when the id is absent from the table, update (bumping `version`) when present. */
  save(entity: SaveEntity<T>): Promise<T>
  /** Sets `deleted_at`. Never issues a hard delete. Soft-deleting twice is a no-op. */
  softDelete(id: string): Promise<void>
  /** Clears `deleted_at`. Restoring a live row is a no-op. */
  restore(id: string): Promise<void>
}
