import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable, Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Downloading a file and proving it is the file we meant.
 *
 * Extracted from `../models/download.ts` when the sidecar installer (sub-phase 6.4) needed the
 * same three guarantees for a 148 MB ffmpeg archive that the model downloader already had for
 * a 300 MB ONNX graph:
 *
 *  - **Verified.** The bytes are hashed *as they are written*, and the file is only given its
 *    real name once the digest and the length both match what the checked-in manifest says. A
 *    truncated or tampered download therefore never exists under the name anything looks for;
 *    it is simply missing, and fetched again.
 *  - **Atomic enough.** The transfer lands on `<target>.part` and is renamed into place. A
 *    crash leaves either the old file or no file, never half of a new one.
 *  - **Survivable on Windows.** See `replaceFile`.
 *
 * There is deliberately no byte-range resume. Resuming mid-file means carrying a partial hash
 * across process restarts, and at desktop speeds the largest artifact here is a few minutes.
 * Both callers resume at *file* granularity instead, which needs no state at all.
 */

/** The `fetch` shape this module needs; injected in tests, `globalThis.fetch` in the app. */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean
  status: number
  statusText: string
  body: unknown
  arrayBuffer(): Promise<ArrayBuffer>
}>

/**
 * Backoff before each attempt of `replaceFile`, in ms — six tries over ~0.8 s.
 *
 * Long enough to outlast a virus scan of a few hundred KB, short enough that a genuinely
 * locked file still fails inside a test's timeout rather than looking like a hang.
 */
const REPLACE_RETRY_DELAYS_MS = [0, 25, 50, 100, 200, 400] as const

/** Windows codes for "someone else has this file open right now"; all transient. */
const TRANSIENT_LOCK_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'])

function isTransientLock(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code !== undefined && TRANSIENT_LOCK_CODES.has(code)
}

/**
 * Moves `partial` onto `target`, replacing whatever is there, in a way that survives Windows.
 *
 * On Linux and macOS the first `rename` is atomic, succeeds, and nothing else here runs. On
 * Windows `MoveFileExW` with REPLACE_EXISTING has to open the *destination*, and the
 * destination can be held by something outside this process — Defender scans a file the
 * moment it is written, and in a re-download these files were written seconds ago by the run
 * this one is replacing. That is exactly the shape of the `windows-latest` failure the model
 * downloader hit: the tests that replace an existing file stalled past their timeout while the
 * six that only ever *create* one finished in 17–170 ms.
 *
 * Two things make it survivable. Unlinking first turns a replace into a create, which does not
 * need a handle on the destination at all; and both steps are retried with backoff, because
 * the lock is a passing scan rather than a permanent state. A crash between the two leaves the
 * target missing, which the next status check reads as "not installed" and fetches again — the
 * same outcome as a half-written file, and never a wrong one.
 *
 * A freshly downloaded `ffmpeg.exe` is if anything more exposed to this than a model file: it
 * is an executable, which is precisely what a scanner opens first.
 */
export async function replaceFile(partial: string, target: string): Promise<void> {
  let lastError: unknown
  for (const backoff of REPLACE_RETRY_DELAYS_MS) {
    if (backoff > 0) await delay(backoff)
    try {
      await rm(target, { force: true })
      await rename(partial, target)
      return
    } catch (error) {
      if (!isTransientLock(error)) throw error
      lastError = error
    }
  }
  throw lastError
}

function asNodeStream(body: unknown): NodeJS.ReadableStream {
  if (body === null || body === undefined) throw new Error('the response carried no body')
  // A WHATWG `ReadableStream` (global `fetch`) or an already-Node stream (a test's fake).
  if (typeof (body as { pipe?: unknown }).pipe === 'function') {
    return body as NodeJS.ReadableStream
  }
  return Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0])
}

export interface DownloadToFileOptions {
  url: string
  target: string
  /** Lower-case hex. The download fails rather than landing if the digest differs. */
  expectedSha256: string
  /** Checked alongside the digest: a length mismatch is the cheaper of the two to explain. */
  expectedBytes?: number
  /**
   * What to call this artifact in an error — a manifest-relative file name, never the URL.
   *
   * These messages end up in `jobs.error` and cross the IPC bridge to the renderer, so the
   * subject has to be something a user can act on ("config.json") rather than an endpoint
   * that only says where our mirror lives.
   */
  subject: string
  fetch?: FetchLike
  signal?: AbortSignal
  onBytes?: (delta: number) => void
  /** Wraps a composed message in the caller's own error class. */
  describe?: (message: string) => Error
}

/** Bytes written. Throws before the file is named if anything does not match. */
export async function downloadToFile(options: DownloadToFileOptions): Promise<number> {
  const {
    url,
    target,
    expectedSha256,
    expectedBytes,
    subject,
    fetch = globalThis.fetch as unknown as FetchLike,
    signal,
    onBytes,
    describe = (message) => new Error(message),
  } = options

  const response = await fetch(url, {
    ...(signal === undefined ? {} : { signal }),
    headers: { accept: 'application/octet-stream' },
  })
  if (!response.ok) {
    throw describe(`${response.status} ${response.statusText} downloading ${subject}`)
  }

  await mkdir(dirname(target), { recursive: true })
  const partial = `${target}.part`
  const hash = createHash('sha256')
  let written = 0

  // The hash has to see every byte on the way past, which is what this Transform is for.
  //
  // Both halves of this matter, and an earlier hand-rolled version got both wrong:
  //
  //  - `pipeline` resolves only once the *destination is closed*, not merely finished.
  //    `WriteStream.end(callback)` fires on `'finish'`, while the file descriptor is still
  //    open — and renaming over an existing file with an open handle fails on Windows.
  //  - `pipeline` propagates an error instead of hanging. Hand-written backpressure
  //    (`write()` then `await once(stream, 'drain')`) never settles if the stream errors or is
  //    destroyed in between, because no `'drain'` is ever emitted — a hang, not a failure.
  const tap = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      hash.update(chunk)
      written += chunk.byteLength
      onBytes?.(chunk.byteLength)
      callback(null, chunk)
    },
  })

  try {
    await pipeline(asNodeStream(response.body), tap, createWriteStream(partial), {
      // Aborts the whole chain and destroys every stream in it, including the open fd.
      ...(signal === undefined ? {} : { signal }),
    })

    const digest = hash.digest('hex')
    if (digest !== expectedSha256) {
      throw describe(
        `${subject} does not match the manifest: expected ${expectedSha256}, got ${digest}`,
      )
    }
    if (expectedBytes !== undefined && written !== expectedBytes) {
      throw describe(`${subject} is ${written} bytes, the manifest says ${expectedBytes}`)
    }
    await replaceFile(partial, target)
    return written
  } catch (error) {
    // Whatever went wrong — a reset connection, a wrong hash, a cancellation — the partial
    // file is not something a later run should find and trust. `pipeline` has already
    // destroyed the streams by the time this runs, so the handle is closed and the unlink
    // cannot fail on Windows either.
    await rm(partial, { force: true })
    throw error
  }
}
