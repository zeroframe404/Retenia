import { join } from 'node:path'
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
