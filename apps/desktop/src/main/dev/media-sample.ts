import { readFileSync } from 'node:fs'
import type { BlobStore } from '@retenia/core'
import { MEDIA_BLOB_HOST, MEDIA_SCHEME } from '../protocol/media-protocol'

/**
 * Puts `sourceFile` into the blob store (idempotent — content-addressed dedupe means a
 * second call for the same bytes is a no-op) and returns its `media://` URL. Backs the
 * dev-only test page that proves seeking works against a real file end to end (sub-phase
 * 1.3); the real writer landed with the blob store in sub-phase 3.5.
 */
export async function ensureDevMediaSample(
  sourceFile: string,
  blobStore: BlobStore,
  mime = 'audio/ogg',
): Promise<string> {
  const { sha256, ext } = await blobStore.put(readFileSync(sourceFile), mime)
  const suffix = ext ? `.${ext}` : ''
  return `${MEDIA_SCHEME}://${MEDIA_BLOB_HOST}/${sha256}${suffix}`
}
