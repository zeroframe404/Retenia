import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_MIGRATIONS,
  type ActivityMigration,
  ActivityMigrationError,
  CURRENT_SCHEMA_VERSION,
  migrateActivity,
} from './migrations'

/** The `schemaVersion` chain (`docs/spec/03-activities.md` §8). */
describe('migrateActivity()', () => {
  const v1 = { schemaVersion: 1, type: 'mcq_single' }

  it('passes a current activity through untouched', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1)
    expect(ACTIVITY_MIGRATIONS).toEqual([])
    expect(migrateActivity(v1)).toEqual({ activity: v1, from: 1, to: 1, applied: [] })
  })

  it('rejects a missing, non-integer, string or zero version', () => {
    for (const json of [
      {},
      null,
      'x',
      { schemaVersion: '1' },
      { schemaVersion: 1.5 },
      { schemaVersion: 0 },
    ]) {
      expect(() => migrateActivity(json)).toThrow(ActivityMigrationError)
      try {
        migrateActivity(json)
      } catch (error) {
        expect((error as ActivityMigrationError).reason).toBe('missing-version')
      }
    }
  })

  it('rejects an activity newer than the target', () => {
    expect(() => migrateActivity({ schemaVersion: 2 })).toThrow(/newer/)
    try {
      migrateActivity({ schemaVersion: 2 })
    } catch (error) {
      expect((error as ActivityMigrationError).reason).toBe('newer-version')
      expect((error as ActivityMigrationError).name).toBe('ActivityMigrationError')
    }
  })

  it('applies an injected chain step by step and reports what ran', () => {
    const migrations: ActivityMigration[] = [
      {
        from: 1,
        to: 2,
        migrate: (json) => ({ ...(json as object), schemaVersion: 2, renamed: true }),
      },
      { from: 2, to: 3, migrate: (json) => ({ ...(json as object), schemaVersion: 3 }) },
    ]
    expect(migrateActivity(v1, { migrations, target: 3 })).toEqual({
      activity: { schemaVersion: 3, type: 'mcq_single', renamed: true },
      from: 1,
      to: 3,
      applied: [1, 2],
    })
    expect(migrateActivity({ schemaVersion: 2 }, { migrations, target: 3 }).applied).toEqual([2])
  })

  it('fails on a gap in the chain', () => {
    const migrations: ActivityMigration[] = [{ from: 2, to: 3, migrate: (json) => json }]
    expect(() => migrateActivity(v1, { migrations, target: 3 })).toThrow(
      /no migration from schemaVersion 1/,
    )
    try {
      migrateActivity(v1, { migrations, target: 3 })
    } catch (error) {
      expect((error as ActivityMigrationError).reason).toBe('unsupported-version')
    }
  })
})
