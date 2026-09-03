import { createRequire } from 'node:module'
import BetterSqlite3, { type Database } from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { getLoadablePath } from 'sqlite-vec'
import * as schema from './schema'

/**
 * Opens (or creates) the application database: pragmas, sqlite-vec, Drizzle.
 *
 * Main or utility process only — `better-sqlite3` must never reach the renderer
 * (CLAUDE.md). A single writer at a time (docs/spec/07-architecture.md §5).
 */

/** The Drizzle handle, typed with the full schema so `db.query.<table>` and inserts are
 * checked against the tables in `src/schema`. */
export type DrizzleDatabase = BetterSQLite3Database<typeof schema> & { $client: Database }

export type SqliteDriver = 'better-sqlite3' | 'better-sqlite3-multiple-ciphers'

/** Special path that opens an in-memory database (tests, scratch work). */
export const IN_MEMORY = ':memory:'

export interface OpenDatabaseOptions {
  /**
   * Encrypts the file at rest (AES-256-class ChaCha20-Poly1305 via SQLite3 Multiple
   * Ciphers). Requires the optional `better-sqlite3-multiple-ciphers` driver; the plain
   * driver would silently ignore the key, so combining the two is an error. The key itself
   * comes from `safeStorage` in the main process — never from settings or a file.
   */
  encryptionKey?: string
  /** Feature flag for the driver. Defaults to the cipher driver when `encryptionKey` is
   * set, the plain driver otherwise. */
  driver?: SqliteDriver
  /** Load the sqlite-vec extension (needed for `embeddings`). Defaults to `true`. */
  loadVec?: boolean
  /**
   * Where to find sqlite-vec's loadable extension, overriding the path the package reports.
   *
   * `loadExtension` hands the path to SQLite, which opens it with the real OS loader — so
   * Electron's asar filesystem shim does not apply and the file has to exist on disk. A
   * packaged build therefore passes the `app.asar.unpacked` path here (see
   * `apps/desktop/src/main/db/open.ts`). Everywhere else the default is correct.
   */
  vecExtensionPath?: string
  /** Open read-only (backups, integrity checks). */
  readonly?: boolean
  /** `busy_timeout` in milliseconds; defaults to 5000. */
  busyTimeoutMs?: number
}

export interface OpenedDatabase {
  readonly path: string
  readonly driver: SqliteDriver
  /** Whether sqlite-vec was loaded into this connection. */
  readonly vecLoaded: boolean
  /** The raw better-sqlite3 handle: pragmas, `exec`, transactions, FTS/vec queries. */
  readonly sqlite: Database
  /** The Drizzle instance over the same connection. */
  readonly db: DrizzleDatabase
  close(): void
}

/** The operation pragmas of docs/spec/07-architecture.md §5, in the order they are applied. */
export const DATABASE_PRAGMAS = {
  journal_mode: 'WAL',
  synchronous: 'NORMAL',
  foreign_keys: 'ON',
  busy_timeout: 5000,
  cache_size: -64000,
  temp_store: 'MEMORY',
} as const

type DriverConstructor = typeof BetterSqlite3

function loadCipherDriver(): DriverConstructor {
  const require = createRequire(import.meta.url)
  try {
    // The fork has the same API as better-sqlite3 plus the encryption pragmas, so the
    // constructor is typed as better-sqlite3's. Resolved lazily: it is an optional
    // dependency, and most installs never need it.
    return require('better-sqlite3-multiple-ciphers') as DriverConstructor
  } catch (error) {
    throw new Error(
      'openDatabase: encryption requires the optional driver "better-sqlite3-multiple-ciphers", ' +
        'which is not installed.',
      { cause: error },
    )
  }
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Opens the database at `path` (`:memory:` for an in-memory one), applies the pragmas,
 * loads sqlite-vec and wraps the connection in Drizzle. Does **not** run migrations — call
 * `migrate()` right after (the app does so on every start; tests use `openTestDatabase`).
 */
export function openDatabase(path: string, options: OpenDatabaseOptions = {}): OpenedDatabase {
  const driver: SqliteDriver =
    options.driver ??
    (options.encryptionKey !== undefined ? 'better-sqlite3-multiple-ciphers' : 'better-sqlite3')

  if (options.encryptionKey !== undefined && driver !== 'better-sqlite3-multiple-ciphers') {
    throw new Error(
      'openDatabase: encryptionKey was given but the driver is plain "better-sqlite3", ' +
        'which would ignore it. Use driver "better-sqlite3-multiple-ciphers".',
    )
  }
  if (options.encryptionKey !== undefined && options.encryptionKey.length === 0) {
    throw new Error('openDatabase: encryptionKey must not be empty')
  }
  if (options.encryptionKey !== undefined && path === IN_MEMORY) {
    throw new Error(
      'openDatabase: an in-memory database cannot be encrypted (SQLite3 Multiple Ciphers keys files only)',
    )
  }

  const Driver = driver === 'better-sqlite3-multiple-ciphers' ? loadCipherDriver() : BetterSqlite3
  const sqlite = new Driver(path, { readonly: options.readonly ?? false })

  try {
    if (options.encryptionKey !== undefined) {
      // Cipher first, then key: SQLite3 Multiple Ciphers reads `cipher` when `key` is set.
      // Pinned explicitly so a future default change in the library cannot lock users out.
      sqlite.pragma("cipher = 'chacha20'")
      sqlite.pragma(`key = ${quoteSqlString(options.encryptionKey)}`)
      // Fail now, not at the first query: a wrong key surfaces as SQLITE_NOTADB here.
      sqlite.prepare('SELECT count(*) FROM sqlite_master').get()
    }

    if (!options.readonly) {
      sqlite.pragma(`journal_mode = ${DATABASE_PRAGMAS.journal_mode}`)
    }
    sqlite.pragma(`synchronous = ${DATABASE_PRAGMAS.synchronous}`)
    sqlite.pragma(`foreign_keys = ${DATABASE_PRAGMAS.foreign_keys}`)
    sqlite.pragma(`busy_timeout = ${options.busyTimeoutMs ?? DATABASE_PRAGMAS.busy_timeout}`)
    sqlite.pragma(`cache_size = ${DATABASE_PRAGMAS.cache_size}`)
    sqlite.pragma(`temp_store = ${DATABASE_PRAGMAS.temp_store}`)

    const vecLoaded = options.loadVec ?? true
    if (vecLoaded) {
      sqlite.loadExtension(options.vecExtensionPath ?? getLoadablePath())
    }

    const db = drizzle(sqlite, { schema })

    return {
      path,
      driver,
      vecLoaded,
      sqlite,
      db,
      close: () => {
        if (sqlite.open) sqlite.close()
      },
    }
  } catch (error) {
    sqlite.close()
    throw error
  }
}
