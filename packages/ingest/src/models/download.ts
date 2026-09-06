import { downloadToFile, type FetchLike } from '../net/fetch-to-file'
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

/** Re-exported: this module was the original home of the injected-`fetch` seam, and the
 *  model download tests import it from here. */
export type { FetchLike }

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

/**
 * Fetches one model file into place, verified against the manifest.
 *
 * The transfer itself — stream, hash on the way past, `.part` then rename with the Windows
 * lock retry — lives in `../net/fetch-to-file.ts`, shared with the sidecar installer
 * (sub-phase 6.4). What stays here is the part that is about *models*: the URL shape, and
 * turning a failure into a `ModelDownloadError` that names the file.
 */
async function downloadFile(
  spec: ModelSpec,
  file: ModelFile,
  target: string,
  options: Required<Pick<DownloadOptions, 'fetch' | 'endpoint'>> & DownloadOptions,
  onBytes: (delta: number) => void,
): Promise<number> {
  try {
    return await downloadToFile({
      url: modelFileUrl(spec, file, options.endpoint),
      target,
      expectedSha256: file.sha256,
      expectedBytes: file.bytes,
      subject: file.path,
      fetch: options.fetch,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      onBytes,
      describe: (message) => new ModelDownloadError(message, file.path),
    })
  } catch (error) {
    // A cancelled transfer arrives as Node's generic `AbortError` ("The operation was
    // aborted"), which would land in the job's `error` column and tell the user nothing. Say
    // the same thing the loop in `downloadModel` says when it stops between files.
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
