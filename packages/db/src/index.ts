/**
 * `@retenia/db` — the SQLite layer of Retenia. Main/utility process only.
 *
 * - `openDatabase(path, options)` → pragmas, sqlite-vec, Drizzle + raw handle.
 * - `migrate(db)` → applies `packages/db/migrations/*.sql`, records `_migrations`.
 * - `schema` → the Drizzle tables (also importable from `@retenia/db/schema`).
 * - `searchChunksFts` / `knnChunks` → the FTS5 and vec0 primitives.
 * - `createHybridSearch(deps)` → BM25 ∪ vector → RRF → reranker → top-N.
 * - `createRepositories(opened, options)` → the `@retenia/core` repository ports,
 *   implemented over Drizzle; `withTransaction` for a multi-repository write.
 */

export type {
  HybridSearch,
  HybridSearchDeps,
  SqliteVectorIndexOptions,
  VectorHit,
  VectorIndex,
  VectorQuery,
} from './hybrid-search'
export {
  createHybridSearch,
  createSqliteVectorIndex,
  DEFAULT_CANDIDATES,
  DEFAULT_TOP_N,
  RRF_K,
} from './hybrid-search'
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
export type { RepositoryContext, RepositoryOptions } from './repositories'
export {
  ConstraintViolationError,
  createRepositories,
  SYNCABLE_TABLES,
  withTransaction,
} from './repositories'
export * as schema from './schema'
export type {
  EmbeddingRow,
  FtsHit,
  FtsQueryOptions,
  FtsSearchOptions,
  KnnHit,
  KnnOptions,
  VectorPrecision,
} from './search'
export {
  deleteEmbeddingsForChunk,
  EMBEDDING_DIMENSIONS,
  FTS_COLUMN_WEIGHTS,
  FTS_TOKENIZER,
  ftsQuery,
  insertEmbedding,
  knnChunks,
  quantizeToInt8,
  searchChunksFts,
  vectorToBlob,
} from './search'
