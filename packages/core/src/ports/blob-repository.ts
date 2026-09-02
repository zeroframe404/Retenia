import type { Blob } from '../entities'
import type { CrudRepository, ListOptions } from './audit'

/**
 * The content-addressed blob index. **The one table where a hard delete is legal**: an
 * unreferenced blob is garbage, not history (`docs/spec/00-conventions.md`). Removing the
 * file from disk is the blob store's job (sub-phase 3.5); this only drops the row.
 */
export interface BlobRepository extends CrudRepository<Blob> {
  findBySha256(sha256: string): Promise<Blob | undefined>
  /** Blobs no live `sources` or `source_units` row points at. */
  listUnreferenced(options?: ListOptions): Promise<Blob[]>
  /** Hard `DELETE`. Refuses to remove a blob that is still referenced — pass only shas
   *  `listUnreferenced` returned. Returns how many rows went. */
  collectGarbage(shas: readonly string[]): Promise<number>
}
