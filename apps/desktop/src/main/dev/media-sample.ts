import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MEDIA_BLOB_HOST, MEDIA_SCHEME } from '../protocol/media-protocol'

/**
 * Copy `sourceFile` into the blob store under its own sha256 hash (idempotent) and return
 * its `media://` URL. Backs the dev-only test page that proves seeking works against a real
 * file end to end (sub-phase 1.3) — there is no blob store writer yet (that lands in 3.5),
 * so this is a narrow, dev-only stand-in for one.
 */
export function ensureDevMediaSample(sourceFile: string, blobsRoot: string, ext = 'ogg'): string {
  const hash = createHash('sha256').update(readFileSync(sourceFile)).digest('hex')
  const dir = join(blobsRoot, hash.slice(0, 2))
  const dest = join(dir, `${hash}.${ext}`)

  if (!existsSync(dest)) {
    mkdirSync(dir, { recursive: true })
    copyFileSync(sourceFile, dest)
  }

  return `${MEDIA_SCHEME}://${MEDIA_BLOB_HOST}/${hash}.${ext}`
}
