/**
 * Heuristic-only (path substring): a startup warning, not a hard block — `docs/spec/
 * 07-architecture.md` §11 lists "SQLite corruption (power cuts, OneDrive over `%APPDATA%`)"
 * as a real risk, since a cloud-sync client rewriting the `.db`/`-wal`/`-shm` trio mid-write
 * (or locking one of them) is exactly the kind of concurrent access SQLite's WAL mode does
 * not defend against.
 */
const SYNCED_FOLDER_MARKERS = ['onedrive', 'dropbox', 'google drive', 'googledrive', 'icloud drive']

/** Whether any path segment of `userDataPath` names a known cloud-sync client's folder. */
export function isPathInSyncedFolder(userDataPath: string): boolean {
  const normalized = userDataPath.replace(/\\/g, '/').toLowerCase()
  const segments = normalized.split('/')
  return segments.some((segment) => SYNCED_FOLDER_MARKERS.includes(segment))
}
