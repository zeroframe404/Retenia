/**
 * mime -> extension, the inverse of `../protocol/media-protocol.ts`'s `MIME_TYPES` table
 * (kept separate rather than shared/derived: that table picks a *display* mime per
 * extension for `Content-Type`, several extensions mapping to the same mime — `mp4`/`m4v`
 * both to `video/mp4` — so a naive inversion would be lossy and pick arbitrarily. This one
 * picks the canonical extension the blob store actually writes files under.
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
