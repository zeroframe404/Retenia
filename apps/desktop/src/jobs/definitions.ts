import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { type JobContext, type JobDefinition, registerJob } from '@retenia/core'
import { canonicalize, confinePath, isInsideRoot, JobCancelledError, whenAborted } from './confine'
import { createFsrsOptimizeJob } from './fsrs-optimize'

// Re-exported from their own module: they are shared with `fsrsOptimize` and are the one
// copy of the path-confinement check.
export { canonicalize, confinePath, isInsideRoot, JobCancelledError, whenAborted }

/**
 * Every job kind this build can run.
 *
 * `sleep` and `hashFile` are the demo pair the queue shipped with, exercising it end to
 * end — progress, cancellation, retries, the `utilityProcess` round trip. `fsrsOptimize`
 * (sub-phase 4.6) is the first real one: it trains the FSRS parameters on the user's own
 * review history.
 *
 * No Electron imports: main pulls this in for the registry's metadata (so it can reject an
 * unknown kind at enqueue time) and the worker pulls it in to actually run.
 */

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
  return {
    type: 'hashFile',
    parseInput: (payload) => {
      const path = payload.path
      if (typeof path !== 'string' || path.length === 0) {
        throw new Error('hashFile needs a non-empty string "path"')
      }
      return { path }
    },
    run: async (input, ctx) => hashFile(await confinePath(roots, input.path, 'hashFile'), ctx),
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
  return [
    registerJob(sleepJob),
    registerJob(createHashFileJob(readableRoots)),
    registerJob(createFsrsOptimizeJob(readableRoots)),
  ]
}
