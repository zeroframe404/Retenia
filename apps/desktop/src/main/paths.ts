import { join, sep } from 'node:path'
import { app } from 'electron'

/** `userData/blobs`, the content-addressed store `media://` serves from
 * (docs/spec/07-architecture.md §5). The real writer lands with the blob store in 3.5. */
export function getBlobsRoot(): string {
  return join(app.getPath('userData'), 'blobs')
}

/**
 * `userData/work`: scratch a job may read, owned by the app.
 *
 * Not the OS temp directory, which is world-writable on Linux and can be cleaned out
 * between a job's attempts; and not the blob store, which is content-addressed and
 * index-backed, so a throwaway training CSV there would either leak a row or need a
 * garbage-collection exception. Added to the worker pool's readable roots, so a job's path
 * is still confined to somewhere the app put it.
 */
export function getWorkRoot(): string {
  return join(app.getPath('userData'), 'work')
}

/**
 * `userData/models`, where the local ONNX embedding and reranker models live
 * (`docs/spec/05-ingestion-rag.md` §3).
 *
 * The layout under it is the model's Hugging Face repository path, because that is what
 * `@huggingface/transformers` resolves a local model from when `env.localModelPath` points
 * here and remote models are off — which is how the app guarantees that loading a model
 * never reaches the network (`packages/ingest/src/models/store.ts`).
 *
 * Deliberately not the blob store: these files are content-addressed by the checked-in
 * manifest, not by the `blobs` table, they are re-downloadable rather than user data, and a
 * blob GC pass has no business deciding a 300 MB model is unreferenced.
 */
export function getModelsRoot(): string {
  return join(app.getPath('userData'), 'models')
}

/**
 * `userData/bin`, where the media sidecars are downloaded (sub-phase 6.4).
 *
 * Separate from both the blob store and the models root, because it holds a third kind of
 * thing: *executables*. They are re-downloadable rather than user data, so a backup should
 * skip them; they are verified against the checked-in manifest rather than by the `blobs`
 * table, so a blob GC pass has no business here; and they are versioned by upstream release
 * tag (`<bin>/ffmpeg/autobuild-2026-09-06-13-06/ffmpeg`), so a pinned-version bump downloads
 * beside the old build instead of over a binary that may be running.
 *
 * `docs/spec/07-architecture.md` §13.4 records why the app downloads these rather than
 * bundling them: a 148 MB ffmpeg and a 670 MB CUDA whisper would dominate a 90–120 MB
 * installer and would all have to be code-signed, and §11 names on-demand sidecars as the
 * mitigation for antivirus false positives.
 */
export function getSidecarsRoot(): string {
  return join(app.getPath('userData'), 'bin')
}

/**
 * `<app>/resources/bin` — the first tier the sidecar resolver looks in.
 *
 * Nothing is shipped there today, but `electron-builder.yml` already allowlists and
 * `asarUnpack`s the directory against the "optional GPU package" §11 imagines, and a build
 * that does bundle a binary should win over whatever was downloaded last week. Run through
 * `resolveUnpacked` because a spawned process is opened by the OS loader, which cannot read
 * through `app.asar`.
 */
export function getBundledSidecarsRoot(): string {
  return resolveUnpacked(join(process.resourcesPath ?? app.getAppPath(), 'bin'))
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
 * Resolved relative to `import.meta.dirname` (`out/main`, wherever electron-vite bundled it), not
 * `app.getAppPath()`: Playwright's `_electron.launch` points straight at
 * `out/main/index.js`, which makes `getAppPath()` resolve to `out/main` itself rather than
 * the package root — there is no `package.json` for it to find on the way there.
 */
export function getDevMediaSamplePath(): string {
  return join(import.meta.dirname, '../../resources/dev/sample.ogg')
}

/** `userData/retenia.db` — the single SQLite file, alongside its `-wal` and `-shm`
 * (`docs/spec/07-architecture.md` §5). Main is its only writer. */
export function getDatabasePath(): string {
  return join(app.getPath('userData'), 'retenia.db')
}

/** `userData/backups`, where `db.backup()` snapshots land daily and on quit, rotated to the
 * newest 7 (`docs/spec/07-architecture.md` §5). */
export function getBackupsRoot(): string {
  return join(app.getPath('userData'), 'backups')
}

/**
 * `out/main/job-worker.js`, the entry point `utilityProcess.fork` runs.
 *
 * Resolved from `import.meta.dirname` for the same reason as `getDevMediaSamplePath`: electron-vite
 * emits both this and `index.js` into `out/main`, so the two sit side by side in a dev run,
 * in a packaged asar, and under Playwright — which launches `out/main/index.js` directly and
 * would defeat any resolution that went through `app.getAppPath()`.
 */
export function getJobWorkerPath(): string {
  return join(import.meta.dirname, 'job-worker.js')
}

/** `out/main/embedding-host.js`, the long-lived model host of sub-phase 6.3. Resolved the
 *  same way and for the same reasons as the job worker above. */
export function getEmbeddingHostPath(): string {
  return join(import.meta.dirname, 'embedding-host.js')
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
