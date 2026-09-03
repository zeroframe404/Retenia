import type { BlobRepository, BlobStore } from '@retenia/core'
import { log } from '../logging/log'

export interface BlobGcResult {
  /** Every unreferenced sha found, whether or not this run actually removed it (a dry run
   *  removes none). */
  candidates: Array<{ sha256: string; bytes: number }>
  /** Shas whose row was dropped and file deleted. Empty on a dry run. */
  collected: string[]
  bytesFreed: number
}

/**
 * Sweep blobs no live `sources`/`source_units` row points at (`BlobRepository.
 * listUnreferenced`), and — unless `dryRun` — drop their row (the one legal hard delete,
 * `docs/spec/00-conventions.md`) and their file. Always dry-run first, per the task: call
 * with `dryRun: true`, show the candidates, then run again with `dryRun: false` once the
 * user confirms.
 *
 * The row is deleted before the file so a crash between the two steps leaves an orphaned
 * file (harmless, another GC pass or a future "verify blobs" tool can still find it by
 * walking the store) rather than a row pointing at nothing.
 */
export async function collectBlobGarbage(
  blobRepo: BlobRepository,
  blobStore: BlobStore,
  options: { dryRun: boolean },
): Promise<BlobGcResult> {
  const unreferenced = await blobRepo.listUnreferenced()
  const candidates = unreferenced.map((blob) => ({ sha256: blob.sha256, bytes: blob.bytes }))

  if (options.dryRun || candidates.length === 0) {
    return { candidates, collected: [], bytesFreed: 0 }
  }

  const shas = candidates.map((c) => c.sha256)
  await blobRepo.collectGarbage(shas)

  const collected: string[] = []
  let bytesFreed = 0
  for (const blob of unreferenced) {
    try {
      await blobStore.delete(blob.sha256, blob.ext)
      collected.push(blob.sha256)
      bytesFreed += blob.bytes
    } catch (error) {
      // The row is already gone; a file that fails to delete is a leak, not data loss —
      // logged so it can be found again, never thrown (the rest of the batch should not be
      // abandoned over one stubborn file, e.g. held open on Windows).
      log.error('[blobs] gc: row removed but file delete failed for', blob.sha256, error)
    }
  }

  return { candidates, collected, bytesFreed }
}
