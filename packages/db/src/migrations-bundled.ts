import type { Migration } from './migrator'
import { MigrationError } from './migrator'

/**
 * The migrations, inlined into the bundle rather than read from disk.
 *
 * `loadMigrations` resolves the migration directory from `import.meta.url`, which is correct
 * when this package runs from source (vitest, `tsx`) but wrong the moment a bundler inlines
 * it somewhere else — and `apps/desktop` must bundle `@retenia/db`, because the package
 * ships TypeScript with no build step and Node cannot `require` a `.ts` file. So the Electron
 * main process imports the SQL through this entry point instead, and the files travel inside
 * `out/main/index.js` with no path arithmetic, no `extraResources`, and one code path shared
 * by `electron-vite dev`, a packaged asar and Playwright.
 *
 * This is a **separate entry point** (`@retenia/db/migrations-bundled`) on purpose:
 * `import.meta.glob` is a bundler feature, and the main entry has to keep working under plain
 * Node for this package's own scripts.
 *
 * `migrations-bundled.test.ts` asserts this list matches `loadMigrations()` exactly, so a
 * migration added without the glob picking it up fails a test rather than shipping a
 * half-migrated database.
 */

const MIGRATION_PATH = /(\d{4})_[a-z0-9_-]+\.sql$/i

/**
 * `import.meta.glob` is provided by the bundler (Vite, and therefore Vitest and
 * electron-vite), not by the runtime.
 *
 * Typed here rather than by pulling in `vite/client`: this package does not depend on Vite —
 * it only ever *runs* under one for this entry point — and under pnpm's strict layout those
 * types are not resolvable from here anyway.
 */
interface BundlerImportMeta {
  glob(
    pattern: string,
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>
}

const sources = (import.meta as unknown as BundlerImportMeta).glob('../migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function build(): readonly Migration[] {
  const parsed = Object.entries(sources).map(([path, sql]) => {
    const match = MIGRATION_PATH.exec(path)
    if (!match) {
      throw new MigrationError(
        `Bundled migration "${path}" does not match NNNN_name.sql (drizzle-kit naming)`,
        path,
      )
    }
    const file = path.slice(path.lastIndexOf('/') + 1)
    return {
      index: Number.parseInt(match[1] as string, 10),
      name: file.slice(0, -'.sql'.length),
      sql,
    }
  })

  parsed.sort((a, b) => a.index - b.index)
  parsed.forEach((entry, position) => {
    if (entry.index !== position) {
      throw new MigrationError(
        `Bundled migration numbering is not contiguous at "${entry.name}" (expected index ${position})`,
        entry.name,
      )
    }
  })

  return Object.freeze(parsed.map(({ name, sql }) => ({ name, sql })))
}

/** Every migration, in application order. Pass to `migrate(target, { migrations })`. */
export const bundledMigrations: readonly Migration[] = build()
