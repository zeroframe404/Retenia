import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import path, { resolve } from 'node:path'
import { type JobContext, type JobDefinition, registerJob } from '@retenia/core'

/**
 * The two demo jobs the queue ships with.
 *
 * They exist to exercise the queue end to end — progress, cancellation, retries, the
 * `utilityProcess` round trip — before any real producer exists. `sleep` is the test vehicle;
 * `hashFile` is the one that does actual work and streams a real file.
 *
 * No Electron imports: main pulls this in for the registry's metadata (so it can reject an
 * unknown kind at enqueue time) and the worker pulls it in to actually run.
 */

/** Thrown when a job notices its own cancellation. The runner tells it apart from a fault. */
export class JobCancelledError extends Error {
  constructor() {
    super('The job was cancelled')
    this.name = 'JobCancelledError'
  }
}

/** Rejects as soon as the signal aborts, so a job can race it against its own work. */
function whenAborted(ctx: JobContext): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (ctx.signal.aborted) {
      reject(new JobCancelledError())
      return
    }
    ctx.signal.addEventListener('abort', () => reject(new JobCancelledError()))
  })
}

export interface SleepInput {
  ms: number
}

/**
 * Waits, reporting progress as it goes, and stops promptly when cancelled.
 *
 * Deliberately cooperative: it proves the `AbortSignal` really reaches the worker, which the
 * runner's kill-after-grace fallback would otherwise mask.
 */
export const sleepJob: JobDefinition<SleepInput, { sleptMs: number }> = {
  type: 'sleep',
  parseInput: (payload) => {
    const ms = payload.ms
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
      throw new Error(`sleep needs a non-negative numeric "ms", got ${JSON.stringify(ms)}`)
    }
    return { ms }
  },
  run: async ({ ms }, ctx) => {
    const steps = 20
    const step = ms / steps
    for (let done = 0; done < steps; done += 1) {
      await Promise.race([
        new Promise<void>((resolve) => {
          setTimeout(resolve, step)
        }),
        whenAborted(ctx),
      ])
      ctx.progress((done + 1) / steps, `slept ${Math.round((done + 1) * step)}ms`)
    }
    return { sleptMs: ms }
  },
}

export interface HashFileInput {
  path: string
}

/**
 * Put a root in the same form `realpath` gives the candidate.
 *
 * A directory that does not exist yet — the blob store before anything has been ingested —
 * cannot be resolved, so it falls back to `resolve`. That is the safe direction: nothing can
 * be *inside* a directory that does not exist, so the comparison simply fails to match.
 */
async function canonicalize(root: string): Promise<string> {
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
 * sha256 of a file, streamed.
 *
 * Streamed rather than read whole: a source in this app can be a 2 GB video, and the point of
 * running in a worker is not to be the process that holds it all in memory.
 *
 * The path comes from whoever enqueued the job, and is confined to `roots` before anything
 * opens it. Today the only enqueuer is main — the demo channel picks the file itself and the
 * contract has no field for a path — so nothing can currently point this anywhere. The check
 * is here regardless, because this definition is the template the ingestion jobs will copy,
 * and a job payload is persisted data: no more trustworthy than whoever wrote it.
 *
 * Both the candidate and the roots go through `realpath` before they are compared, so a
 * symlink inside a root cannot lead out of it — and so the two sides are in the same form to
 * begin with (see `isInsideRoot`).
 */
export function createHashFileJob(
  roots: readonly string[],
): JobDefinition<HashFileInput, { sha256: string; bytes: number }> {
  /** The real path of `candidate`, or a throw if it is not inside one of `roots`. */
  const confine = async (candidate: string): Promise<string> => {
    const real = await realpath(resolve(candidate))
    const resolvedRoots = await Promise.all(roots.map(canonicalize))
    const inside = resolvedRoots.some((root) => isInsideRoot(path, root, real))
    if (!inside) {
      // Deliberately does not echo the path: this message reaches the renderer.
      throw new Error('hashFile refused a path outside the directories it may read')
    }
    return real
  }

  return {
    type: 'hashFile',
    parseInput: (payload) => {
      const path = payload.path
      if (typeof path !== 'string' || path.length === 0) {
        throw new Error('hashFile needs a non-empty string "path"')
      }
      return { path }
    },
    run: async (input, ctx) => hashFile(await confine(input.path), ctx),
  }
}

async function hashFile(path: string, ctx: JobContext): Promise<{ sha256: string; bytes: number }> {
  const { size } = await stat(path)
  const hash = createHash('sha256')
  const stream = createReadStream(path)

  let read = 0
  try {
    for await (const chunk of stream) {
      if (ctx.signal.aborted) throw new JobCancelledError()
      const buffer = chunk as Buffer
      hash.update(buffer)
      read += buffer.byteLength
      // A zero-byte file would divide by zero; it is also already finished.
      ctx.progress(size === 0 ? 1 : read / size, `${read}/${size} bytes`)
    }
  } finally {
    // An abort mid-stream leaves the descriptor open otherwise.
    stream.destroy()
  }

  return { sha256: hash.digest('hex'), bytes: read }
}

/**
 * Every kind this build can run, built for a given set of readable roots.
 *
 * A function rather than a constant because `hashFile` needs those roots, and they come from
 * Electron's `app.getPath` — which this module must not import, since it is shared with the
 * worker bundle and has to stay free of Electron.
 */
export function createJobDefinitions(readableRoots: readonly string[]) {
  return [registerJob(sleepJob), registerJob(createHashFileJob(readableRoots))]
}
