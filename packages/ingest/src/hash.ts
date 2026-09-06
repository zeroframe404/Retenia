import { createHash } from 'node:crypto'

/** sha256 of UTF-8 `text`, lowercase hex — the same shape `chunks.hash`/`blobs.sha256` use. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
