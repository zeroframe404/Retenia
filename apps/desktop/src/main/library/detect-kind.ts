import type { SourceKind } from '@retenia/core'

/**
 * What the Library can import by file extension (sub-phase 6.1). Deliberately the same set
 * `../blobs/mime.ts`'s `MIME_TO_EXT` table already recognises — the mime here is what gets
 * handed to `BlobStore.put`, and `extForMime` mapping it straight back to the same extension
 * is what makes that round-trip lossless.
 */
const EXTENSION_INFO: Readonly<Record<string, { kind: SourceKind; mime: string }>> = {
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  docx: {
    kind: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  epub: { kind: 'epub', mime: 'application/epub+zip' },
  pptx: {
    kind: 'pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  md: { kind: 'markdown', mime: 'text/markdown' },
  markdown: { kind: 'markdown', mime: 'text/markdown' },
  txt: { kind: 'text', mime: 'text/plain' },
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
}

export const IMPORTABLE_EXTENSIONS = Object.keys(EXTENSION_INFO)

export class UnsupportedSourceTypeError extends Error {
  constructor(fileName: string) {
    super(`"${fileName}" is not a supported file type for import`)
    this.name = 'UnsupportedSourceTypeError'
  }
}

/** The `SourceKind` and canonical mime for a file, from its extension alone — reading the
 *  actual bytes (magic numbers) is not worth it for what the Library imports. Throws
 *  `UnsupportedSourceTypeError` for anything outside `IMPORTABLE_EXTENSIONS`. */
export function detectSource(fileName: string): { kind: SourceKind; mime: string } {
  const ext = fileName.split('.').pop()?.toLowerCase()
  const info = ext !== undefined ? EXTENSION_INFO[ext] : undefined
  if (info === undefined) throw new UnsupportedSourceTypeError(fileName)
  return info
}
