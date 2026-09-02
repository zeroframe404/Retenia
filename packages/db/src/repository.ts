import type { Clock, IdGenerator } from '@retenia/core'

/**
 * Port every SQLite-backed repository implements (real `better-sqlite3` implementations
 * land in sub-phase 3.2). No hard deletes: `softDelete` sets `deleted_at`, it never issues
 * a SQL `DELETE` (see `docs/spec/00-conventions.md`).
 */
export interface Repository<T extends { id: string }> {
  findById(id: string): T | undefined
  save(entity: T): void
  softDelete(id: string, deletedAt: Date): void
}

/** In-memory `Repository` used to unit-test consumers of the port before F3 lands SQLite. */
export function createInMemoryRepository<T extends { id: string; deletedAt?: Date }>(
  clock: Clock,
  ids: IdGenerator,
): Repository<T> & { create(entity: Omit<T, 'id'>): T } {
  const rows = new Map<string, T>()

  return {
    findById: (id) => rows.get(id),
    save: (entity) => {
      rows.set(entity.id, entity)
    },
    softDelete: (id, deletedAt = clock.now()) => {
      const existing = rows.get(id)
      if (existing) rows.set(id, { ...existing, deletedAt })
    },
    create: (entity) => {
      const withId = { ...entity, id: ids.next() } as T
      rows.set(withId.id, withId)
      return withId
    },
  }
}
