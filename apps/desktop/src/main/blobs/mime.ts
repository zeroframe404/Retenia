/**
 * mime -> extension: which extension the blob store writes a file under.
 *
 * It is not the inverse of `../protocol/media-protocol.ts`'s `MIME_TYPES` and cannot be derived
 * from it — that table picks a *display* mime per extension for `Content-Type`, with several
 * extensions mapping to one mime (`mp4`/`m4v` both to `video/mp4`), so inverting it would pick
 * arbitrarily. What the two tables owe each other is narrower and one-directional: **every
 * extension named here must be a key of `MIME_TYPES`**, or the store writes `<sha256>.<ext>`
 * files that `media://` refuses and that the bare-hash form cannot reach either. A mime with no
 * row here is stored extensionless, which stays servable as `application/octet-stream`;
 * `media-protocol.test.ts` pins the two tables against each other.
 */
const MIME_TO_EXT: Readonly<Record<string, string>> = Object.freeze({
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/flac': 'flac',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
})

/** Lowercase, no dot; `null` for a mime the table does not know — the blob is still stored
 *  (extensionless), just not servable by name from `media://` without a hint. */
export function extForMime(mime: string): string | null {
  return MIME_TO_EXT[mime.toLowerCase().trim()] ?? null
}
