/**
 * The v1 domain schema (docs/spec/07a-schema.md is generated from the migrated database).
 *
 * Import order matters only for readability: every table references others by id, and the
 * files are arranged so that references point "upward" (library → paths → exams → memory →
 * system → sessions → gamification) with no cycles.
 *
 * Not modelled here, because Drizzle cannot express virtual tables:
 * - `chunks_fts` (FTS5 over `chunks`) and its sync triggers;
 * - `embeddings` (sqlite-vec `vec0`, `float[768]`);
 * - `_migrations`, owned by `src/migrator.ts`.
 * All three are created by `migrations/0001_fts5_vec0_seed.sql`.
 */

export {
  IMPORTANCE_LEVELS,
  type ImportanceLevel,
  type JsonObject,
  type JsonValue,
} from './_common'
export * from './exams'
export * from './gamification'
export * from './library'
export * from './memory'
export * from './paths'
export * from './sessions'
export * from './system'
