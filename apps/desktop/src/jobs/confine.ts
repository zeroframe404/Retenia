import { realpath } from 'node:fs/promises'
import path, { resolve } from 'node:path'

/**
 * Confining a job's file access to the directories it was told it may read.
 *
 * Extracted from `hashFile` when the optimizer job needed the same guarantee. This is
 * security-relevant code and there is exactly one copy of it on purpose: a second, subtly
 * different implementation is how a path check stops holding.
 *
 * No Electron imports — this module is shared with the worker bundle.
 */

/** Thrown when a job notices its own cancellation. The runner tells it apart from a fault. */
export class JobCancelledError extends Error {
  constructor() {
    super('The job was cancelled')
    this.name = 'JobCancelledError'
  }
}

/**
 * Put a root in the same form `realpath` gives the candidate.
 *
 * A directory that does not exist yet — the blob store before anything has been ingested —
 * cannot be resolved, so it falls back to `resolve`. That is the safe direction: nothing can
 * be *inside* a directory that does not exist, so the comparison simply fails to match.
 */
export async function canonicalize(root: string): Promise<string> {
  try {
    return await realpath(resolve(root))
  } catch {
    return resolve(root)
  }
}

/**
 * Whether `candidate` is `root` or sits underneath it.
 *
 * Uses `relative` rather than comparing strings with `startsWith`, because a prefix test is
 * wrong on Windows in two ways that a Linux run never shows: paths differ in case while the
 * filesystem does not, and `os.tmpdir()` hands back 8.3 short names (`RUNNER~1`) that
 * `realpath` expands. `path.win32.relative` handles both — it compares case-insensitively and
 * works in path segments, so it also cannot be fooled by a sibling directory whose name
 * merely starts with the root's (`…\blobs-evil` vs `…\blobs`).
 *
 * The `path` module is a parameter so the win32 behaviour is testable from any platform.
 */
export function isInsideRoot(
  pathModule: Pick<typeof path, 'relative' | 'isAbsolute'>,
  root: string,
  candidate: string,
): boolean {
  const difference = pathModule.relative(root, candidate)
  // '' is the root itself; '..' anywhere at the front means the candidate escaped it, and an
  // absolute result means the two are not even on the same drive.
  return difference === '' || (!difference.startsWith('..') && !pathModule.isAbsolute(difference))
}

/**
 * The real path of `candidate`, or a throw if it is not inside one of `roots`.
 *
 * Both sides go through `realpath` before they are compared, so a symlink inside a root
 * cannot lead out of it — and so the two are in the same form to begin with.
 *
 * A job payload is persisted data, no more trustworthy than whoever wrote it, so this runs
 * even where the only enqueuer today is main.
 */
export async function confinePath(
  roots: readonly string[],
  candidate: string,
  jobName: string,
): Promise<string> {
  const real = await realpath(resolve(candidate))
  const resolvedRoots = await Promise.all(roots.map(canonicalize))
  if (!resolvedRoots.some((root) => isInsideRoot(path, root, real))) {
    // Deliberately does not echo the path: this message reaches the renderer.
    throw new Error(`${jobName} refused a path outside the directories it may read`)
  }
  return real
}

/** Rejects as soon as the signal aborts, so a job can race it against its own work. */
export function whenAborted(ctx: {
  signal: { aborted: boolean; addEventListener(type: 'abort', listener: () => void): void }
}): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (ctx.signal.aborted) {
      reject(new JobCancelledError())
      return
    }
    ctx.signal.addEventListener('abort', () => reject(new JobCancelledError()))
  })
}
