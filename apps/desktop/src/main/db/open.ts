import type { UnitOfWork } from '@retenia/core'
import { createRepositories, migrate, type OpenedDatabase, openDatabase } from '@retenia/db'
import { bundledMigrations } from '@retenia/db/migrations-bundled'
import { getLoadablePath } from 'sqlite-vec'
import { log } from '../logging/log'
import { getDatabasePath, resolveUnpacked } from '../paths'

/**
 * The application database, opened once in main.
 *
 * Main is the **single writer** (`docs/spec/07-architecture.md` §5): job workers never open
 * SQLite, they receive a payload and post a result back. That keeps one WAL connection for
 * the process, keeps `better-sqlite3` out of every worker bundle, and makes recycling a
 * worker free — there is no live database handle to tear down.
 */

export interface AppDatabase {
  readonly opened: OpenedDatabase
  readonly repos: UnitOfWork
  close(): void
}

/**
 * Open `userData/retenia.db`, bring it up to date, and build the repositories.
 *
 * Two details are load-bearing in a packaged build:
 *
 * - **The migrations come from the bundle, not the disk.** `@retenia/db` ships TypeScript
 *   source, so electron-vite has to bundle it, which invalidates the `import.meta.url`
 *   arithmetic behind `loadMigrations`' default directory.
 * - **sqlite-vec's extension is loaded from outside the asar.** `loadExtension` goes to the
 *   OS loader, which cannot see through `app.asar`; `electron-builder.yml` unpacks the
 *   package and `resolveUnpacked` points at the copy that exists on disk. This is not
 *   optional — migration `0001` creates a `vec0` virtual table, so the extension has to be
 *   loaded before a fresh database can be built at all.
 */
export function openAppDatabase(deviceId: string): AppDatabase {
  const path = getDatabasePath()
  const opened = openDatabase(path, { vecExtensionPath: resolveUnpacked(getLoadablePath()) })

  try {
    const result = migrate(opened, { migrations: [...bundledMigrations] })
    if (result.applied.length > 0) {
      log.info('[db] applied migrations:', result.applied.join(', '))
    }
  } catch (error) {
    opened.close()
    throw error
  }

  const repos = createRepositories(opened, { deviceId })
  return {
    opened,
    repos,
    close: () => opened.close(),
  }
}
