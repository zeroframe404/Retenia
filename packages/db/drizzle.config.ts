import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit configuration (stable 0.31.x with drizzle-orm 0.45.x — the 1.0 line is
 * still an RC and is deliberately not used).
 *
 * - `pnpm --filter @retenia/db migrations:generate` diffs `src/schema` against the last
 *   snapshot in `migrations/meta` and writes `migrations/NNNN_<name>.sql`.
 * - `pnpm --filter @retenia/db migrations:custom -- --name <name>` writes an empty
 *   numbered file for raw SQL Drizzle cannot express (virtual tables, triggers, seeds).
 *
 * Migrations are applied at runtime by `src/migrator.ts`, not by drizzle-kit: it records
 * them in `_migrations` and refuses to run if an applied file has changed. Never edit a
 * file under `migrations/` once it has shipped — add a new one (docs/spec/00-conventions.md).
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
})
