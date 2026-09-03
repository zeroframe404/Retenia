import { describe, expect, it } from 'vitest'
import { bundledMigrations } from './migrations-bundled'
import { appliedMigrations, hashMigration, loadMigrations, migrate } from './migrator'
import { openTestDatabase } from './testing'

/**
 * The bundled list and the on-disk directory are two views of the same files, and only one of
 * them ships to users. If they ever diverge — a migration added while the glob pattern missed
 * it, say — the desktop app would silently run an older schema than every test in this
 * repository. That is what these assertions exist to prevent.
 */
describe('bundled migrations', () => {
  const onDisk = loadMigrations()

  it('has every migration the directory has, in the same order', () => {
    expect(bundledMigrations.map((m) => m.name)).toEqual(onDisk.map((m) => m.name))
  })

  it('carries byte-identical SQL', () => {
    for (const [index, migration] of bundledMigrations.entries()) {
      expect(hashMigration(migration.sql)).toBe(hashMigration(onDisk[index]?.sql ?? ''))
    }
  })

  it('is not empty, which is how a broken glob would present itself', () => {
    expect(bundledMigrations.length).toBeGreaterThan(0)
  })

  it('recognises a database built from disk as already migrated', () => {
    const opened = openTestDatabase()
    try {
      // `openTestDatabase` already migrated from disk. Replaying the bundled list must find
      // every name and hash recorded — which is only true if the two sources agree.
      const result = migrate(opened, { migrations: [...bundledMigrations] })
      expect(result.applied).toEqual([])
      expect(appliedMigrations(opened).map((m) => m.name)).toEqual(
        bundledMigrations.map((m) => m.name),
      )
    } finally {
      opened.close()
    }
  })
})
