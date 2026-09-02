/**
 * `@retenia/db` — the SQLite layer of Retenia. Main/utility process only.
 *
 * - `openDatabase(path, options)` → pragmas, sqlite-vec, Drizzle + raw handle.
 * - `migrate(db)` → applies `packages/db/migrations/*.sql`, records `_migrations`.
 * - `schema` → the Drizzle tables (also importable from `@retenia/db/schema`).
 * - `searchChunksFts` / `knnChunks` → the FTS5 and vec0 primitives.
 * - `Repository` → the port SQLite repositories implement (sub-phase 3.2).
 */

export type {
  AppliedMigration,
  MigrateOptions,
  MigrateResult,
  Migration,
  MigrationTarget,
} from './migrator'
export {
  appliedMigrations,
  DEFAULT_MIGRATIONS_DIR,
  hashMigration,
  loadMigrations,
  MIGRATIONS_TABLE,
  MigrationError,
  migrate,
  pendingMigrations,
} from './migrator'
export type {
  DrizzleDatabase,
  OpenDatabaseOptions,
  OpenedDatabase,
  SqliteDriver,
} from './open-database'
export { DATABASE_PRAGMAS, IN_MEMORY, openDatabase } from './open-database'
export type { Repository } from './repository'
export { createInMemoryRepository } from './repository'
export * as schema from './schema'
export type {
  EmbeddingRow,
  FtsHit,
  FtsSearchOptions,
  KnnHit,
  KnnOptions,
} from './search'
export {
  deleteEmbeddingsForChunk,
  EMBEDDING_DIMENSIONS,
  FTS_TOKENIZER,
  ftsQuery,
  insertEmbedding,
  knnChunks,
  searchChunksFts,
  vectorToBlob,
} from './search'
