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
  type Migration,
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
  'ai_batches',
  'ai_calls',
  'ai_results',
  'annotations',
  'attempts',
  'blobs',
  'cards',
  'chunks',
  'chunks_fts',
  'diagnostic_sessions',
  'embeddings',
  'exam_attempts',
  'exam_items',
  'exams',
  'extractions',
  'generation_runs',
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
  'remediations',
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
      '0008_chunk_identity_and_context',
      '0009_source_embedding_state',
      '0010_source_reading_progress',
      '0011_chunks_fts_trigram',
      '0012_ai_results',
      '0013_ai_batches',
      '0014_generation_runs_and_extractions',
      '0015_lesson_expansion',
      '0016_lesson_qa_status',
      '0017_diagnostic_sessions',
      '0018_remediations',
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
      '0008_chunk_identity_and_context',
      '0009_source_embedding_state',
      '0010_source_reading_progress',
      '0011_chunks_fts_trigram',
      '0012_ai_results',
      '0013_ai_batches',
      '0014_generation_runs_and_extractions',
      '0015_lesson_expansion',
      '0016_lesson_qa_status',
      '0017_diagnostic_sessions',
      '0018_remediations',
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
      '0008_chunk_identity_and_context',
      '0009_source_embedding_state',
      '0010_source_reading_progress',
      '0011_chunks_fts_trigram',
      '0012_ai_results',
      '0013_ai_batches',
      '0014_generation_runs_and_extractions',
      '0015_lesson_expansion',
      '0016_lesson_qa_status',
      '0017_diagnostic_sessions',
      '0018_remediations',
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
    expect(migrate(opened.sqlite).applied).toHaveLength(19)
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

  /**
   * The upgrade path of `0017`, which gives `item_bank` a CHECKed `authoring` column while
   * `exam_items.item_bank_id` points into it. An existing bank row has to come through with
   * `authoring = '{}'`, the exam item that references it has to still reference it, and both
   * the new CHECK and the old foreign key have to still bite afterwards.
   */
  it('carries item_bank rows, and the exam_items pointing at them, through 0017', () => {
    opened = openDatabase(IN_MEMORY)
    const shipped = loadMigrations()
    const at = shipped.findIndex((m) => m.name === '0017_diagnostic_sessions')
    expect(at).toBeGreaterThan(0)

    migrate(opened, { migrations: shipped.slice(0, at) })

    const now = Date.now()
    const id = (n: string) => `0199aaaa-bbbb-7ccc-8ddd-${n.padStart(12, '0')}`
    const audit = `${now}, ${now}, 'test-device', 1`
    opened.sqlite.exec(
      `INSERT INTO activities (id, type, family, lang, difficulty, config, grading, created_at, updated_at, device_id, version)
       VALUES ('${id('1')}', 'mcq_single', 'choice', 'es', 2, '{}', '{}', ${audit})`,
    )
    opened.sqlite.exec(
      `INSERT INTO item_bank (id, activity_id, usage, difficulty_logit, exposure, stats, created_at, updated_at, device_id, version)
       VALUES ('${id('2')}', '${id('1')}', '["diagnostic"]', -0.8, 3, '{"n":3}', ${audit})`,
    )
    opened.sqlite.exec(
      `INSERT INTO exams (id, title, kind, created_at, updated_at, device_id, version)
       VALUES ('${id('3')}', 'Simulacro', 'mock', ${audit})`,
    )
    opened.sqlite.exec(
      `INSERT INTO exam_items (id, exam_id, ordinal, activity_id, item_bank_id, created_at, updated_at, device_id, version)
       VALUES ('${id('4')}', '${id('3')}', 0, '${id('1')}', '${id('2')}', ${audit})`,
    )

    migrate(opened)

    expect(
      opened.sqlite
        .prepare('SELECT id, usage, difficulty_logit, exposure, stats, authoring FROM item_bank')
        .all(),
    ).toEqual([
      {
        id: id('2'),
        usage: '["diagnostic"]',
        difficulty_logit: -0.8,
        exposure: 3,
        stats: '{"n":3}',
        authoring: '{}',
      },
    ])
    expect(opened.sqlite.prepare('SELECT item_bank_id FROM exam_items').all()).toEqual([
      { item_bank_id: id('2') },
    ])
    expect(opened.sqlite.pragma('foreign_key_check')).toEqual([])
    expect(opened.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(
      (opened.sqlite.pragma("index_list('item_bank')") as { name: string; origin: string }[])
        .filter((index) => index.origin === 'c')
        .map((index) => index.name)
        .sort(),
    ).toEqual(['item_bank_activity', 'item_bank_module', 'item_bank_version'])

    // The new CHECK holds on the upgraded table...
    expect(() =>
      opened.sqlite.exec(`UPDATE item_bank SET authoring = '[]' WHERE id = '${id('2')}'`),
    ).toThrow(/item_bank_authoring_json/)
    // ...and the foreign keys into and out of it are still enforced.
    expect(() =>
      opened.sqlite.exec(
        `INSERT INTO exam_items (id, exam_id, ordinal, activity_id, item_bank_id, created_at, updated_at, device_id, version)
         VALUES ('${id('5')}', '${id('3')}', 1, '${id('1')}', '${id('99')}', ${audit})`,
      ),
    ).toThrow(/FOREIGN KEY constraint failed/)
    expect(() =>
      opened.sqlite.exec(
        `INSERT INTO item_bank (id, activity_id, created_at, updated_at, device_id, version)
         VALUES ('${id('6')}', '${id('98')}', ${audit})`,
      ),
    ).toThrow(/FOREIGN KEY constraint failed/)
  })

  /**
   * The upgrade of a collection that already has lessons with activities, cards and a
   * remediation, through `0015` and `0016` — both rebuild `lessons`, which every one of those
   * rows points at. With foreign keys enforced inside the file's transaction, the `DROP` of
   * the old table failed at commit; the migrator now follows SQLite's rebuild procedure.
   */
  it.each(['0015_lesson_expansion', '0016_lesson_qa_status'])(
    'carries lessons with activities, cards and remediations through the rebuild of %s',
    (name) => {
      opened = openDatabase(IN_MEMORY)
      const shipped = loadMigrations()
      const at = shipped.findIndex((m) => m.name === name)
      expect(at).toBeGreaterThan(0)
      migrate(opened, { migrations: shipped.slice(0, at) })

      const now = Date.now()
      const id = (n: string) => `0199aaaa-bbbb-7ccc-8ddd-${n.padStart(12, '0')}`
      const audit = `${now}, ${now}, 'test-device', 1`
      const exec = (sql: string) => opened.sqlite.exec(sql)
      exec(
        `INSERT INTO paths (id, title, language, created_at, updated_at, device_id, version)
         VALUES ('${id('1')}', 'Curso', 'es', ${audit})`,
      )
      exec(
        `INSERT INTO path_versions (id, path_id, number, spec, created_at, updated_at, device_id, version)
         VALUES ('${id('2')}', '${id('1')}', 1, '{}', ${audit})`,
      )
      exec(
        `INSERT INTO sections (id, path_version_id, ordinal, spec_id, title, created_at, updated_at, device_id, version)
         VALUES ('${id('3')}', '${id('2')}', 0, 'S01', 'Sección', ${audit})`,
      )
      exec(
        `INSERT INTO modules (id, section_id, ordinal, spec_id, title, created_at, updated_at, device_id, version)
         VALUES ('${id('4')}', '${id('3')}', 0, 'M01', 'Módulo', ${audit})`,
      )
      exec(
        `INSERT INTO lessons (id, module_id, ordinal, spec_id, title, created_at, updated_at, device_id, version)
         VALUES ('${id('5')}', '${id('4')}', 0, 'L01', 'Lección', ${audit})`,
      )
      exec(
        `INSERT INTO lessons (id, module_id, ordinal, spec_id, kind, parent_lesson_id, title, created_at, updated_at, device_id, version)
         VALUES ('${id('6')}', '${id('4')}', 1, 'L01.r1', 'remediation', '${id('5')}', 'Refuerzo', ${audit})`,
      )
      exec(
        `INSERT INTO activities (id, lesson_id, type, family, lang, config, grading, created_at, updated_at, device_id, version)
         VALUES ('${id('7')}', '${id('5')}', 'mcq_single', 'choice', 'es', '{}', '{}', ${audit})`,
      )
      exec(
        `INSERT INTO knowledge_items (id, lesson_id, kind, fields, created_at, updated_at, device_id, version)
         VALUES ('${id('8')}', '${id('5')}', 'fact', '{}', ${audit})`,
      )

      migrate(opened)

      expect(
        opened.sqlite.prepare('SELECT id, parent_lesson_id FROM lessons ORDER BY ordinal').all(),
      ).toEqual([
        { id: id('5'), parent_lesson_id: null },
        { id: id('6'), parent_lesson_id: id('5') },
      ])
      expect(opened.sqlite.prepare('SELECT lesson_id FROM activities').all()).toEqual([
        { lesson_id: id('5') },
      ])
      expect(opened.sqlite.prepare('SELECT lesson_id FROM knowledge_items').all()).toEqual([
        { lesson_id: id('5') },
      ])
      expect(opened.sqlite.pragma('foreign_key_check')).toEqual([])
      expect(opened.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
      // The rebuilt table is still a foreign-key target that bites.
      expect(() =>
        exec(
          `INSERT INTO activities (id, lesson_id, type, family, lang, config, grading, created_at, updated_at, device_id, version)
           VALUES ('${id('9')}', '${id('99')}', 'mcq_single', 'choice', 'es', '{}', '{}', ${audit})`,
        ),
      ).toThrow(/FOREIGN KEY constraint failed/)
    },
  )

  it('rolls back a migration that leaves a dangling reference, with enforcement back on', () => {
    opened = openDatabase(IN_MEMORY)
    const shipped = loadMigrations()
    migrate(opened, { migrations: shipped })
    const now = Date.now()
    const dangling: Migration = {
      name: `${String(shipped.length).padStart(4, '0')}_dangling_reference`,
      sql: `INSERT INTO activities (id, lesson_id, type, family, lang, config, grading, created_at, updated_at, device_id, version)
            VALUES ('0199aaaa-bbbb-7ccc-8ddd-000000000001', '0199aaaa-bbbb-7ccc-8ddd-000000000999', 'mcq_single', 'choice', 'es', '{}', '{}', ${now}, ${now}, 'test-device', 1);`,
    }

    expect(() => migrate(opened, { migrations: [...shipped, dangling] })).toThrow(
      /foreign-key violation/,
    )
    expect(opened.sqlite.prepare('SELECT count(*) AS n FROM activities').get()).toEqual({ n: 0 })
    expect(appliedMigrations(opened).map((row) => row.name)).not.toContain(dangling.name)
    expect(opened.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('tolerates a dangling reference older than the migration, and still catches a new one', () => {
    opened = openDatabase(IN_MEMORY)
    const shipped = loadMigrations()
    migrate(opened, { migrations: shipped })
    const now = Date.now()
    const activity = (n: string, lessonId: string) =>
      `INSERT INTO activities (id, lesson_id, type, family, lang, config, grading, created_at, updated_at, device_id, version)
       VALUES ('0199aaaa-bbbb-7ccc-8ddd-${n.padStart(12, '0')}', '${lessonId}', 'mcq_single', 'choice', 'es', '{}', '{}', ${now}, ${now}, 'test-device', 1);`
    // A collection restored from somewhere that already carries a broken reference.
    opened.sqlite.pragma('foreign_keys = OFF')
    opened.sqlite.exec(activity('1', '0199aaaa-bbbb-7ccc-8ddd-000000000998'))
    opened.sqlite.pragma('foreign_keys = ON')

    const harmless: Migration = {
      name: `${String(shipped.length).padStart(4, '0')}_harmless_probe`,
      sql: 'CREATE TABLE harmless_probe (id TEXT PRIMARY KEY);',
    }
    expect(migrate(opened, { migrations: [...shipped, harmless] }).applied).toEqual([harmless.name])

    const dangling: Migration = {
      name: `${String(shipped.length + 1).padStart(4, '0')}_dangling_reference`,
      sql: activity('2', '0199aaaa-bbbb-7ccc-8ddd-000000000999'),
    }
    expect(() => migrate(opened, { migrations: [...shipped, harmless, dangling] })).toThrow(
      /new foreign-key violations: 1 in activities → lessons/,
    )
    expect(opened.sqlite.prepare('SELECT count(*) AS n FROM activities').get()).toEqual({ n: 1 })
    expect(opened.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })
})
