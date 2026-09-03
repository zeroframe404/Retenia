import { join, sep } from 'node:path'
import { app } from 'electron'

/** `userData/blobs`, the content-addressed store `media://` serves from
 * (docs/spec/07-architecture.md §5). The real writer lands with the blob store in 3.5. */
export function getBlobsRoot(): string {
  return join(app.getPath('userData'), 'blobs')
}

/** `userData/settings.json`: a placeholder store until the real `settings` table lands in
 * sub-phase 3.5 (see `src/main/settings/store.ts`). */
export function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** Where electron-log rotates the main process's log files — `userData/logs` on Windows
 * and Linux, `~/Library/Logs/<app>` on macOS. Matches electron-log's own default
 * (`app.getPath('logs')`) so `app.exportDiagnostics` zips the files that actually exist. */
export function getLogsDir(): string {
  return app.getPath('logs')
}

/**
 * `resources/dev/sample.ogg`, shipped only for the dev-only media test page.
 *
 * Resolved relative to `__dirname` (`out/main`, wherever electron-vite bundled it), not
 * `app.getAppPath()`: Playwright's `_electron.launch` points straight at
 * `out/main/index.js`, which makes `getAppPath()` resolve to `out/main` itself rather than
 * the package root — there is no `package.json` for it to find on the way there.
 */
export function getDevMediaSamplePath(): string {
  return join(__dirname, '../../resources/dev/sample.ogg')
}

/** `userData/retenia.db` — the single SQLite file, alongside its `-wal` and `-shm`
 * (`docs/spec/07-architecture.md` §5). Main is its only writer. */
export function getDatabasePath(): string {
  return join(app.getPath('userData'), 'retenia.db')
}

/**
 * `out/main/job-worker.js`, the entry point `utilityProcess.fork` runs.
 *
 * Resolved from `__dirname` for the same reason as `getDevMediaSamplePath`: electron-vite
 * emits both this and `index.js` into `out/main`, so the two sit side by side in a dev run,
 * in a packaged asar, and under Playwright — which launches `out/main/index.js` directly and
 * would defeat any resolution that went through `app.getAppPath()`.
 */
export function getJobWorkerPath(): string {
  return join(__dirname, 'job-worker.js')
}

/**
 * Rewrite a path that points inside the asar to its unpacked twin.
 *
 * Electron's `fs` shim can read *through* `app.asar`, but anything handed to a native loader
 * cannot: `sqlite.loadExtension` passes the path to SQLite, which opens it with the real OS
 * loader. Those files are listed in `asarUnpack` and therefore exist at the mirrored
 * `app.asar.unpacked` path. A no-op in an unpacked build, where there is no `app.asar`
 * segment to replace.
 */
export function resolveUnpacked(path: string): string {
  return path.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
}
