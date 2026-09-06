import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable, Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import type { ModelFile, ModelSpec } from './catalog'
import type { ModelStore } from './store'

/**
 * On-demand download of a catalog model into the model store
 * (`docs/spec/05-ingestion-rag.md` §3; sub-phase 6.3's "downloaded on demand into
 * `<userData>/models/` with sha256 check and a progress job").
 *
 * Three properties matter more than speed here:
 *
 *  - **Verified.** Every file is hashed *as it is written* and compared against the checked-in
 *    manifest before it is given its real name. A file that does not match never exists under
 *    the name the model loader looks for, so a truncated or tampered download cannot be
 *    loaded on the next start — it is simply missing, and re-downloaded.
 *  - **Resumable at file granularity.** A cancelled run leaves the files it finished in
 *    place; the next run skips them. Byte-range resume within one file is deliberately not
 *    attempted: `Range` plus a streaming hash means keeping partial hash state across
 *    process restarts, and the largest file here is 570 MB on a desktop connection.
 *  - **Cancellable.** The job that drives this is cancellable from the tray, so the fetch
 *    takes the signal and the partial file is removed on the way out.
 */

const HUGGINGFACE = 'https://huggingface.co'

export interface DownloadProgress {
  /** 0–1 over the whole model. */
  fraction: number
  bytesDone: number
  bytesTotal: number
  /** The file being transferred, for the message under the bar. */
  file: string
}

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

export interface DownloadOptions {
  store: ModelStore
  fetch?: FetchLike
  onProgress?: (progress: DownloadProgress) => void
  signal?: AbortSignal
  /** Overrides the host, for tests and for a future mirror setting. No trailing slash. */
  endpoint?: string
}

export interface DownloadResult {
  /** Files actually transferred this run — empty when everything was already valid. */
  downloaded: string[]
  bytesDownloaded: number
  /** Files that were already present and verified. */
  skipped: string[]
}

export class ModelDownloadError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(message)
    this.name = 'ModelDownloadError'
  }
}

export function modelFileUrl(spec: ModelSpec, file: ModelFile, endpoint = HUGGINGFACE): string {
  return `${endpoint}/${spec.repo}/resolve/${spec.revision}/${file.path}`
}

function asNodeStream(body: unknown): NodeJS.ReadableStream {
  if (body === null || body === undefined) throw new Error('the response carried no body')
  // A WHATWG `ReadableStream` (global `fetch`) or an already-Node stream (a test's fake).
  if (typeof (body as { pipe?: unknown }).pipe === 'function') {
    return body as NodeJS.ReadableStream
  }
  return Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0])
}

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
 * this one is replacing. That is exactly the shape of the `windows-latest` failure: the tests
 * that replace an existing file stalled past their timeout while the six in the same file
 * that only ever *create* one finished in 17–170 ms, and the temp directory could not be
 * removed afterwards because a handle was still on it.
 *
 * Two things make it survivable. Unlinking first turns a replace into a create, which does
 * not need a handle on the destination at all; and both steps are retried with backoff,
 * because the lock is a passing scan rather than a permanent state. A crash between the two
 * leaves the target missing, which the next `status()` reads as "not installed" and
 * re-downloads — the same outcome as a half-written file, and never a wrong one.
 */
async function replaceFile(partial: string, target: string): Promise<void> {
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

/**
 * Streams one file to `<final>.part`, hashing as it goes, and only renames it into place
 * once the digest matches. Returns the bytes written.
 */
async function downloadFile(
  spec: ModelSpec,
  file: ModelFile,
  target: string,
  options: Required<Pick<DownloadOptions, 'fetch' | 'endpoint'>> & DownloadOptions,
  onBytes: (delta: number) => void,
): Promise<number> {
  const url = modelFileUrl(spec, file, options.endpoint)
  const response = await options.fetch(url, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    headers: { accept: 'application/octet-stream' },
  })
  if (!response.ok) {
    throw new ModelDownloadError(
      `${response.status} ${response.statusText} downloading ${file.path}`,
      file.path,
    )
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
  //    open — and renaming over an existing file with an open handle fails on Windows. That
  //    is not theoretical: it is the second download of a file after a revision bump, which
  //    is exactly what the CI job on `windows-latest` caught.
  //  - `pipeline` propagates an error instead of hanging. Hand-written backpressure
  //    (`write()` → `await once(stream, 'drain')`) never settles if the stream errors or is
  //    destroyed in between, because no `'drain'` is ever emitted — a hang, not a failure.
  const tap = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      hash.update(chunk)
      written += chunk.byteLength
      onBytes(chunk.byteLength)
      callback(null, chunk)
    },
  })

  try {
    await pipeline(
      asNodeStream(response.body),
      tap,
      createWriteStream(partial),
      // Aborts the whole chain and destroys every stream in it, including the open fd.
      { ...(options.signal === undefined ? {} : { signal: options.signal }) },
    )

    const digest = hash.digest('hex')
    if (digest !== file.sha256) {
      throw new ModelDownloadError(
        `${file.path} does not match the manifest: expected ${file.sha256}, got ${digest}`,
        file.path,
      )
    }
    if (written !== file.bytes) {
      throw new ModelDownloadError(
        `${file.path} is ${written} bytes, the manifest says ${file.bytes}`,
        file.path,
      )
    }
    await replaceFile(partial, target)
    return written
  } catch (error) {
    // Whatever went wrong — a reset connection, a wrong hash, a cancellation — the partial
    // file is not something a later run should find and trust. `pipeline` has already
    // destroyed the streams by the time this runs, so the handle is closed and the unlink
    // cannot fail on Windows either.
    await rm(partial, { force: true })
    // A cancelled transfer reaches here as Node's generic `AbortError` ("The operation was
    // aborted"), which would land in the job's `error` column and tell the user nothing.
    // Say the same thing the loop in `downloadModel` says when it stops between files.
    if (options.signal?.aborted === true) {
      throw new Error(`the model download was cancelled while fetching ${file.path}`)
    }
    throw error
  }
}

/**
 * Makes sure every file of `spec` is on disk and matches the manifest, downloading what is
 * missing. Cheap and synchronous-feeling when the model is already installed: it is a
 * receipt read plus one `stat` per file.
 */
export async function downloadModel(
  spec: ModelSpec,
  options: DownloadOptions,
): Promise<DownloadResult> {
  const resolved = {
    ...options,
    fetch: options.fetch ?? (globalThis.fetch as unknown as FetchLike),
    endpoint: options.endpoint ?? HUGGINGFACE,
  }
  const { store } = options

  const status = await store.status(spec)
  if (status.installed) {
    options.onProgress?.({
      fraction: 1,
      bytesDone: spec.bytes,
      bytesTotal: spec.bytes,
      file: '',
    })
    return { downloaded: [], bytesDownloaded: 0, skipped: spec.files.map((file) => file.path) }
  }

  // A file the receipt does not vouch for is re-fetched rather than re-hashed: the hash we
  // would compute is the one the download computes anyway, and at these sizes reading the
  // file twice costs more than most of the transfer.
  const broken = new Set(status.issues.map((issue) => issue.file))
  const todo = spec.files.filter((file) => broken.has(file.path))
  const skipped = spec.files.filter((file) => !broken.has(file.path)).map((file) => file.path)

  const bytesTotal = todo.reduce((sum, file) => sum + file.bytes, 0)
  let bytesDone = 0
  const downloaded: string[] = []

  const report = (file: string): void => {
    options.onProgress?.({
      fraction: bytesTotal === 0 ? 1 : Math.min(1, bytesDone / bytesTotal),
      bytesDone,
      bytesTotal,
      file,
    })
  }

  for (const file of todo) {
    if (options.signal?.aborted === true) throw new Error('the model download was cancelled')
    report(file.path)
    await downloadFile(spec, file, store.filePath(spec, file), resolved, (delta) => {
      bytesDone += delta
      report(file.path)
    })
    // Vouched for the moment it lands, not at the end of the run: that is what makes a
    // cancelled or crashed download resume at the next file instead of starting over.
    await store.recordVerified(spec, [file.path])
    downloaded.push(file.path)
  }

  // Every file is now vouched for — by this run or by a previous one — so the receipt can
  // cover the whole model and the next `status()` answers without hashing 300 MB again.
  await store.writeReceipt(spec)
  options.onProgress?.({ fraction: 1, bytesDone, bytesTotal, file: '' })
  return { downloaded, bytesDownloaded: bytesDone, skipped }
}
