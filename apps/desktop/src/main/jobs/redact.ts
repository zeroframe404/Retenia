import { app } from 'electron'

/**
 * Strip main-process filesystem paths out of text on its way to the renderer.
 *
 * `register-handlers.ts` already refuses to send a stack across the bridge, on the grounds
 * that "a stack would leak main-process paths into a context that has no business seeing
 * them". A job's `error` is the same kind of text and takes the same trip: Node's fs errors
 * embed the full path (`ENOENT: no such file or directory, open
 * 'C:\\Users\\<name>\\AppData\\...'`), so the first real ingestion failure would otherwise
 * hand the renderer the user's name and library layout.
 *
 * The full text still goes to the log file, which is what "Export diagnostics" collects.
 */

/** Longest first, so a nested directory is replaced before its parent swallows the prefix. */
function roots(): { path: string; label: string }[] {
  const candidates = [
    { path: safely(() => app.getPath('userData')), label: '<userData>' },
    { path: safely(() => app.getAppPath()), label: '<app>' },
    { path: safely(() => app.getPath('home')), label: '<home>' },
  ]
  return candidates
    .filter((entry): entry is { path: string; label: string } => entry.path !== undefined)
    .sort((a, b) => b.path.length - a.path.length)
}

/** `app.getPath` throws for a path the platform does not define. */
function safely(read: () => string): string | undefined {
  try {
    const value = read()
    return value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replace every known root in `text` with a label.
 *
 * Case-insensitive, because Windows paths reach us in whatever case the caller used while
 * the drive itself is case-insensitive. Both separators are matched for the same reason.
 */
export function redactPaths(text: string): string {
  let out = text
  for (const { path, label } of roots()) {
    // Split on the separators and rejoin with a class that matches either, so one pattern
    // catches both `C:\Users\...` and the `C:/Users/...` form Node often produces. Each
    // segment is escaped on its own — rewriting separators *after* escaping would corrupt
    // the backslashes the escaping just introduced.
    const pattern = path
      .split(/[\\/]+/)
      .map(escapeForRegExp)
      .join('[\\\\/]+')
    out = out.replace(new RegExp(pattern, 'gi'), label)
  }
  return out
}

/** `redactPaths` for a value that may be absent. */
export function redactPathsOrNull(text: string | null): string | null {
  return text === null ? null : redactPaths(text)
}
