import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appliedMigrations,
  DEFAULT_MIGRATIONS_DIR,
  hashMigration,
  loadMigrations,
  MIGRATIONS_TABLE,
  MigrationError,
  migrate,
  pendingMigrations,
} from './migrator'
import { IN_MEMORY, type OpenedDatabase, openDatabase } from './open-database'

/** Every table the shipped migrations must leave behind (virtual and shadow tables of
 * FTS5/vec0 excluded — see `SHADOW_TABLE` below). */
const EXPECTED_TABLES = [
  '_migrations',
  'achievements',
  'activities',
  'activity_stats',
  'ai_calls',
  'annotations',
  'attempts',
  'blobs',
  'cards',
  'chunks',
  'chunks_fts',
  'embeddings',
  'exam_attempts',
  'exam_items',
  'exams',
  'importance_levels',
  'item_bank',
  'jobs',
  'knowledge_items',
  'lesson_sessions',
  'lessons',
  'modules',
  'outbox',
  'path_versions',
  'paths',
  'review_logs',
  'review_sessions',
  'scheduler_profiles',
  'sections',
  'settings',
  'source_units',
  'sources',
  'streaks',
  'xp_events',
] as const

/** FTS5 and vec0 create internal `<table>_<suffix>` tables; they are not part of the schema. */
const SHADOW_TABLE = /^(chunks_fts|embeddings)_/

function listTables(opened: OpenedDatabase): string[] {
  return opened.sqlite
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name)
    .filter((name) => !SHADOW_TABLE.test(name))
}

describe('loadMigrations()', () => {
  const tempDirs: string[] = []
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function tempDir(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'retenia-db-migrations-'))
    tempDirs.push(dir)
    for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql)
    return dir
  }

  it('reads the shipped migrations in numeric order', () => {
    const migrations = loadMigrations(DEFAULT_MIGRATIONS_DIR)
    expect(migrations.map((m) => m.name)).toEqual([
      '0000_domain_schema',
      '0001_fts5_vec0_seed',
      '0002_embeddings_int8',
      '0003_review_logs_algorithm_version',
      '0004_card_importance_override_expiry',
      '0005_review_sessions',
      '0006_review_activity_type_and_stats',
      '0007_attempt_mode_and_review_session',
    ])
    for (const migration of migrations) expect(migration.sql.length).toBeGreaterThan(0)
  })

  it('sorts by the numeric prefix, not lexically, and ignores non-SQL files', () => {
    const dir = tempDir({
      '0001_b.sql': 'select 1;',
      '0000_a.sql': 'select 0;',
      'notes.md': 'ignored',
    })
    expect(loadMigrations(dir).map((m) => m.name)).toEqual(['0000_a', '0001_b'])
  })

  it('rejects files that do not follow NNNN_name.sql', () => {
    const dir = tempDir({ '0000_a.sql': 'select 0;', 'later.sql': 'select 1;' })
    expect(() => loadMigrations(dir)).toThrow(MigrationError)
    expect(() => loadMigrations(dir)).toThrow(/does not match/)
  })

  it('rejects gaps in the numbering (a deleted migration)', () => {
    const dir = tempDir({ '0000_a.sql': 'select 0;', '0002_c.sql': 'select 2;' })
    expect(() => loadMigrations(dir)).toThrow(/not contiguous/)
  })
})

describe('migrate()', () => {
  let opened: OpenedDatabase
  afterEach(() => opened?.close())

  it('creates every v1 table on a fresh in-memory database', () => {
    opened = openDatabase(IN_MEMORY)
    const result = migrate(opened)

    expect(result.applied).toEqual([
      '0000_domain_schema',
      '0001_fts5_vec0_seed',
      '0002_embeddings_int8',
      '0003_review_logs_algorithm_version',
      '0004_card_importance_override_expiry',
      '0005_review_sessions',
      '0006_review_activity_type_and_stats',
      '0007_attempt_mode_and_review_session',
    ])
    expect(result.alreadyApplied).toEqual([])
    expect(listTables(opened)).toEqual([...EXPECTED_TABLES])
  })

  it('is idempotent: a second run applies nothing and verifies the recorded hashes', () => {
    opened = openDatabase(IN_MEMORY)
    migrate(opened)
    const again = migrate(opened)

    expect(again.applied).toEqual([])
    expect(again.alreadyApplied).toEqual([
      '0000_domain_schema',
      '0001_fts5_vec0_seed',
      '0002_embeddings_int8',
      '0003_review_logs_algorithm_version',
      '0004_card_importance_override_expiry',
      '0005_review_sessions',
      '0006_review_activity_type_and_stats',
      '0007_attempt_mode_and_review_session',
    ])
    expect(listTables(opened)).toEqual([...EXPECTED_TABLES])
    expect(opened.sqlite.prepare('SELECT count(*) AS n FROM importance_levels').get()).toEqual({
      n: 5,
    })
  })

  it('records name, sha256 and timing in _migrations', () => {
    opened = openDatabase(IN_MEMORY)
    let tick = 1_000
    migrate(opened, { now: () => (tick += 5) })

    const rows = appliedMigrations(opened)
    const shipped = loadMigrations()
    expect(rows.map((row) => row.name)).toEqual(shipped.map((m) => m.name))
    expect(rows.map((row) => row.hash)).toEqual(shipped.map((m) => hashMigration(m.sql)))
    for (const row of rows) {
      expect(row.appliedAt).toBeGreaterThan(1_000)
      expect(row.durationMs).toBe(5)
    }
    expect(
      opened.sqlite
        .prepare(`SELECT sql FROM sqlite_master WHERE name = '${MIGRATIONS_TABLE}'`)
        .get(),
    ).toMatchObject({ sql: expect.stringContaining('WITHOUT ROWID') })
  })

  it('accepts the raw handle and the Drizzle instance as targets too', () => {
    opened = openDatabase(IN_MEMORY)
    expect(migrate(opened.sqlite).applied).toHaveLength(8)
    expect(migrate(opened.db).applied).toHaveLength(0)
  })

  it('applies pending migrations in order and skips the ones already recorded', () => {
    opened = openDatabase(IN_MEMORY)
    const first = { name: '0000_a', sql: 'CREATE TABLE a (x INTEGER);' }
    const second = { name: '0001_b', sql: 'CREATE TABLE b (y INTEGER);' }

    expect(migrate(opened, { migrations: [first] }).applied).toEqual(['0000_a'])
    const result = migrate(opened, { migrations: [first, second] })
    expect(result).toEqual({ applied: ['0001_b'], alreadyApplied: ['0000_a'] })
    expect(listTables(opened)).toEqual(['_migrations', 'a', 'b'])
  })

  it('refuses to run when an applied migration was edited (immutability)', () => {
    opened = openDatabase(IN_MEMORY)
    const original = { name: '0000_a', sql: 'CREATE TABLE a (x INTEGER);' }
    migrate(opened, { migrations: [original] })

    const edited = { name: '0000_a', sql: 'CREATE TABLE a (x INTEGER, y INTEGER);' }
    expect(() => migrate(opened, { migrations: [edited] })).toThrow(MigrationError)
    expect(() => migrate(opened, { migrations: [edited] })).toThrow(/modified after it was applied/)
  })

  it('treats CRLF and LF checkouts of the same migration as identical', () => {
    opened = openDatabase(IN_MEMORY)
    const lf = { name: '0000_a', sql: 'CREATE TABLE a (\n  x INTEGER\n);\n' }
    const crlf = { name: '0000_a', sql: lf.sql.replace(/\n/g, '\r\n') }
    migrate(opened, { migrations: [lf] })
    expect(migrate(opened, { migrations: [crlf] }).alreadyApplied).toEqual(['0000_a'])
  })

  it('refuses a database migrated further than this build knows (no silent downgrade)', () => {
    opened = openDatabase(IN_MEMORY)
    migrate(opened, {
      migrations: [
        { name: '0000_a', sql: 'CREATE TABLE a (x INTEGER);' },
        { name: '0001_b', sql: 'CREATE TABLE b (y INTEGER);' },
      ],
    })
    expect(() =>
      migrate(opened, { migrations: [{ name: '0000_a', sql: 'CREATE TABLE a (x INTEGER);' }] }),
    ).toThrow(/does not include it/)
  })

  it('refuses a pending migration that sorts before an applied one', () => {
    opened = openDatabase(IN_MEMORY)
    const b = { name: '0001_b', sql: 'CREATE TABLE b (y INTEGER);' }
    migrate(opened, { migrations: [b] })
    const a = { name: '0000_a', sql: 'CREATE TABLE a (x INTEGER);' }
    expect(() => migrate(opened, { migrations: [a, b] })).toThrow(/must only ever be appended/)
  })

  it('rolls back the whole file when one statement fails, recording nothing', () => {
    opened = openDatabase(IN_MEMORY)
    const broken = {
      name: '0000_broken',
      sql: 'CREATE TABLE half (x INTEGER);\n--> statement-breakpoint\nCREATE TABLE half (x INTEGER);',
    }

    expect(() => migrate(opened, { migrations: [broken] })).toThrow(MigrationError)
    expect(() => migrate(opened, { migrations: [broken] })).toThrow(/rolled back/)
    expect(listTables(opened)).toEqual(['_migrations'])
    expect(appliedMigrations(opened)).toEqual([])
    expect(pendingMigrations(opened, [broken]).pending).toEqual([broken])
  })

  it('applies the shipped migrations inside transactions (foreign keys stay on)', () => {
    opened = openDatabase(IN_MEMORY)
    migrate(opened)
    expect(opened.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  /**
   * The upgrade path, not the fresh-install one.
   *
   * `0006` widens a CHECK on `review_logs`, which in SQLite means building a new table,
   * copying every row across and renaming it over the old one. Migrating a *fresh*
   * database exercises none of that: there are no rows to copy, and the CHECK expressions
   * are written against `__new_review_logs` and only become the real table's after the
   * rename. This is the test that an existing collection survives the rebuild — and that
   * the renamed table still accepts writes, which it would not if SQLite left those
   * qualified column references pointing at a table that no longer exists.
   */
  it('carries existing review_logs rows through the 0006 table rebuild', () => {
    opened = openDatabase(IN_MEMORY)
    const shipped = loadMigrations()
    const rebuild = shipped.findIndex((m) => m.name === '0006_review_activity_type_and_stats')
    expect(rebuild).toBeGreaterThan(0)

    migrate(opened, { migrations: shipped.slice(0, rebuild) })

    const now = Date.now()
    const id = (n: string) => `0199aaaa-bbbb-7ccc-8ddd-${n.padStart(12, '0')}`
    const audit = `${now}, ${now}, 'test-device', 1`
    opened.sqlite.exec(
      `INSERT INTO knowledge_items (id, kind, fields, importance, status, created_by, tags, created_at, updated_at, device_id, version)
       VALUES ('${id('1')}', 'fact', '{}', 'normal', 'active', 'user', '[]', ${audit})`,
    )
    opened.sqlite.exec(
      `INSERT INTO cards (id, item_id, template, state, due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, suspended, leech, created_at, updated_at, device_id, version)
       VALUES ('${id('2')}', '${id('1')}', 'basic', 2, ${now}, 10.0, 5.0, 1, 0, 1, 0, 0, 0, ${audit})`,
    )
    opened.sqlite.exec(
      `INSERT INTO review_logs (id, card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, review, context, algorithm_version, created_at, updated_at, device_id, version)
       VALUES ('${id('3')}', '${id('2')}', 3, 2, ${now}, 10.0, 5.0, 1, 1, 0, ${now}, 'daily', 'fsrs6', ${audit})`,
    )

    migrate(opened)

    const carried = opened.sqlite
      .prepare<[], { id: string; context: string; activity_type: string | null }>(
        'SELECT id, context, activity_type FROM review_logs',
      )
      .all()
    expect(carried).toEqual([{ id: id('3'), context: 'daily', activity_type: null }])

    // The rebuilt table still takes writes, with both things 0006 added.
    opened.sqlite.exec(
      `INSERT INTO review_logs (id, card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, review, context, activity_type, algorithm_version, created_at, updated_at, device_id, version)
       VALUES ('${id('4')}', '${id('2')}', 3, 2, ${now}, 10.0, 5.0, 1, 1, 0, ${now}, 'diagnostic', 'mcq_single', 'fsrs6', ${audit})`,
    )
    // ...and still rejects what its CHECKs always rejected.
    expect(() =>
      opened.sqlite.exec(
        `INSERT INTO review_logs (id, card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, review, context, algorithm_version, created_at, updated_at, device_id, version)
         VALUES ('${id('5')}', '${id('2')}', 9, 2, ${now}, 10.0, 5.0, 1, 1, 0, ${now}, 'daily', 'fsrs6', ${audit})`,
      ),
    ).toThrow(/CHECK constraint failed/)
  })
})
