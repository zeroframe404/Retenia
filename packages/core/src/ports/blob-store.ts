/**
 * The content-addressed blob store: the actual bytes on disk, keyed by sha256
 * (`docs/spec/07-architecture.md` §5). `BlobRepository` is the database index row; this is
 * the file underneath it. Kept as its own port (rather than folded into `BlobRepository`)
 * because it has nothing to do with SQL — the implementation is a plain filesystem writer
 * (`apps/desktop/src/main/blobs/store.ts`) and never touches `better-sqlite3`.
 *
 * `Uint8Array | AsyncIterable<Uint8Array>` rather than a Node `Buffer`/`Readable` type: this
 * package has zero Node dependencies (CLAUDE.md), so the port stays expressible without
 * `@types/node`.
 */
export interface BlobPutResult {
  sha256: string
  bytes: number
  mime: string
  /** Lowercase, no dot; `null` when `mime` maps to nothing in the known table. */
  ext: string | null
}

export interface BlobStore {
  /**
   * Hash `input` while streaming it to a temp file, then atomically rename into place at
   * `<root>/<sha256[0:2]>/<sha256>.<ext>`. Writing the same bytes twice is a no-op beyond
   * the hash: the second call recognizes the file already exists and discards its temp copy
   * instead of overwriting (content-addressed dedupe).
   */
  put(input: Uint8Array | AsyncIterable<Uint8Array>, mime: string): Promise<BlobPutResult>
  has(sha256: string, ext?: string | null): Promise<boolean>
  /** Absolute path on disk a blob would live at, whether or not it currently does. */
  path(sha256: string, ext?: string | null): string
  get(sha256: string, ext?: string | null): Promise<Uint8Array>
  /** No-op if the file is already gone. */
  delete(sha256: string, ext?: string | null): Promise<void>
}
