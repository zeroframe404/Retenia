import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Database } from 'better-sqlite3'

/**
 * Runtime migrator. Applies the SQL files under `packages/db/migrations/` (written by
 * drizzle-kit, or by hand for what Drizzle cannot express) to a database, in order, each
 * inside its own transaction, and records them in `_migrations`.
 *
 * Immutability contract (docs/spec/00-conventions.md): a migration that has been applied
 * is never edited. The migrator enforces it — the SHA-256 of every applied file is stored,
 * and `migrate()` throws before touching the database if a recorded hash no longer matches
 * the file on disk. Schema changes always go in a *new* file.
 *
 * `_migrations` is the one table without the UUIDv7/audit column set: it is bookkeeping
 * for the schema itself, never synced, and is created here rather than by a migration so
 * a brand-new database can bootstrap.
 */

export const MIGRATIONS_TABLE = '_migrations'

/** `packages/db/migrations`, resolved from this file — works from source (vitest, tsx)
 * and from a build that keeps the directory next to `src/` or ships it as an extra
 * resource. Pass `dir`/`migrations` explicitly when the layout differs. */
export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url))

const MIGRATION_FILE = /^(\d{4})_[a-z0-9_-]+\.sql$/i

export interface Migration {
  /** File name without `.sql`, e.g. `0000_domain_schema`. Its numeric prefix orders it. */
  name: string
  sql: string
}

export interface AppliedMigration {
  name: string
  hash: string
  appliedAt: number
  durationMs: number
}

export interface MigrateOptions {
  /** The migrations to consider, in order. Defaults to reading `dir`. */
  migrations?: readonly Migration[]
  /** Where to read `*.sql` files from when `migrations` is not given. */
  dir?: string
  /** Clock for `applied_at`; defaults to `Date.now`. */
  now?: () => number
}

export interface MigrateResult {
  /** Names applied by this call, in order. */
  applied: string[]
  /** Names that were already recorded and verified. */
  alreadyApplied: string[]
}

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly migration: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'MigrationError'
  }
}

/** Anything that carries a better-sqlite3 handle: the raw handle, an `OpenedDatabase`, or a
 * Drizzle instance (`db.$client`). */
export type MigrationTarget = Database | { sqlite: Database } | { $client: Database }

function resolveSqlite(target: MigrationTarget): Database {
  if ('sqlite' in target && target.sqlite !== undefined) return target.sqlite
  if ('$client' in target && target.$client !== undefined) return target.$client
  return target as Database
}

/** SHA-256 of the file with line endings normalized, so a CRLF checkout on Windows and an
 * LF checkout on Linux agree (the repo forces LF via `.gitattributes`, but belt and braces). */
export function hashMigration(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')
}

/**
 * Reads every `NNNN_name.sql` under `dir`, sorted by its numeric prefix. Rejects files that
 * do not follow the pattern, duplicate prefixes, and gaps — a missing number usually means
 * a migration was deleted, which the immutability rule forbids.
 */
export function loadMigrations(dir: string = DEFAULT_MIGRATIONS_DIR): Migration[] {
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)

  const parsed = entries.map((file) => {
    const match = MIGRATION_FILE.exec(file)
    if (!match) {
      throw new MigrationError(
        `Migration file "${file}" does not match NNNN_name.sql (drizzle-kit naming)`,
        file,
      )
    }
    return { file, index: Number.parseInt(match[1] as string, 10) }
  })
  parsed.sort((a, b) => a.index - b.index)

  parsed.forEach((entry, position) => {
    if (entry.index !== position) {
      throw new MigrationError(
        `Migration numbering is not contiguous at "${entry.file}" (expected index ${position})`,
        entry.file,
      )
    }
  })

  return parsed.map(({ file }) => ({
    name: file.slice(0, -'.sql'.length),
    sql: readFileSync(join(dir, file), 'utf8'),
  }))
}

function ensureMigrationsTable(sqlite: Database): void {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL
    ) WITHOUT ROWID`,
  )
}

/** The migrations recorded in the database, in application order. Empty for a fresh file. */
export function appliedMigrations(target: MigrationTarget): AppliedMigration[] {
  const sqlite = resolveSqlite(target)
  ensureMigrationsTable(sqlite)
  return sqlite
    .prepare<[], { name: string; hash: string; applied_at: number; duration_ms: number }>(
      `SELECT name, hash, applied_at, duration_ms FROM ${MIGRATIONS_TABLE} ORDER BY name`,
    )
    .all()
    .map((row) => ({
      name: row.name,
      hash: row.hash,
      appliedAt: row.applied_at,
      durationMs: row.duration_ms,
    }))
}

/**
 * Splits `migrations` into what is already applied (verified against the recorded hashes)
 * and what still has to run. Throws on an edited applied migration, on a recorded
 * migration this build does not know (a newer app touched the file — do not downgrade
 * silently), and on a pending migration that sorts before an applied one.
 */
export function pendingMigrations(
  target: MigrationTarget,
  migrations: readonly Migration[],
): { pending: Migration[]; alreadyApplied: string[] } {
  const applied = new Map(appliedMigrations(target).map((row) => [row.name, row]))
  const known = new Set(migrations.map((migration) => migration.name))

  for (const name of applied.keys()) {
    if (!known.has(name)) {
      throw new MigrationError(
        `The database has migration "${name}" applied, but this build does not include it. ` +
          'It was probably migrated by a newer version of the app; refusing to continue.',
        name,
      )
    }
  }

  const pending: Migration[] = []
  const alreadyApplied: string[] = []
  for (const migration of migrations) {
    const record = applied.get(migration.name)
    if (record === undefined) {
      pending.push(migration)
      continue
    }
    if (pending.length > 0) {
      throw new MigrationError(
        `Migration "${migration.name}" is applied but "${pending[0]?.name}" sorts before it and ` +
          'is not. Migrations must only ever be appended.',
        migration.name,
      )
    }
    const hash = hashMigration(migration.sql)
    if (hash !== record.hash) {
      throw new MigrationError(
        `Migration "${migration.name}" was modified after it was applied ` +
          `(recorded ${record.hash.slice(0, 12)}…, file ${hash.slice(0, 12)}…). ` +
          'Applied migrations are immutable: write a new migration instead.',
        migration.name,
      )
    }
    alreadyApplied.push(migration.name)
  }

  return { pending, alreadyApplied }
}

/**
 * Applies every pending migration, each in its own transaction, and records it in
 * `_migrations`. Idempotent: a second call finds nothing to do. Safe to run on every app
 * start.
 *
 * A failing statement rolls back the whole file — the schema never ends up half-migrated —
 * and the error names the migration that failed.
 */
export function migrate(target: MigrationTarget, options: MigrateOptions = {}): MigrateResult {
  const sqlite = resolveSqlite(target)
  const now = options.now ?? Date.now
  const migrations = options.migrations ?? loadMigrations(options.dir)

  const { pending, alreadyApplied } = pendingMigrations(sqlite, migrations)

  const record = sqlite.prepare(
    `INSERT INTO ${MIGRATIONS_TABLE} (name, hash, applied_at, duration_ms) VALUES (?, ?, ?, ?)`,
  )

  const applied: string[] = []
  for (const migration of pending) {
    const startedAt = now()
    const apply = sqlite.transaction(() => {
      sqlite.exec(migration.sql)
      record.run(migration.name, hashMigration(migration.sql), startedAt, now() - startedAt)
    })
    try {
      apply()
    } catch (error) {
      throw new MigrationError(
        `Migration "${migration.name}" failed and was rolled back: ${(error as Error).message}`,
        migration.name,
        { cause: error },
      )
    }
    applied.push(migration.name)
  }

  return { applied, alreadyApplied }
}
