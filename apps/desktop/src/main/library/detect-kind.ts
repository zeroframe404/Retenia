import type { SourceKind } from '@retenia/core'

/**
 * What the Library can import by file extension (sub-phases 6.1 and 6.4). Deliberately the
 * same set `../blobs/mime.ts`'s `MIME_TO_EXT` table already recognises — the mime here is what
 * gets handed to `BlobStore.put`, and `extForMime` mapping it straight back to the same
 * extension is what makes that round-trip lossless.
 *
 * The audio and video rows are the ones sub-phase 6.4 added, and they carry a caveat the
 * document rows do not: ffmpeg can *ingest* every container listed here, but the renderer's
 * `<video>` element cannot necessarily *play* all of them — Matroska and QuickTime depend on
 * the codecs inside. That asymmetry is deliberate. Transcoding to a guaranteed-playable
 * container would mean an encoder, and the LGPL ffmpeg build ships none worth having; a
 * source whose transcript, keyframes and citations all work while its preview does not is a
 * far better outcome than refusing the file outright.
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
  // Audio and video (sub-phase 6.4, `docs/spec/05-ingestion-rag.md` §1). `oga` and `opus` are
  // both Ogg, and `m4v` is MPEG-4, so several extensions deliberately share one mime; the
  // round-trip through `extForMime` normalises them to one name on disk, which is what makes
  // the same recording imported twice dedupe to a single blob.
  mp3: { kind: 'audio', mime: 'audio/mpeg' },
  m4a: { kind: 'audio', mime: 'audio/mp4' },
  wav: { kind: 'audio', mime: 'audio/wav' },
  ogg: { kind: 'audio', mime: 'audio/ogg' },
  oga: { kind: 'audio', mime: 'audio/ogg' },
  opus: { kind: 'audio', mime: 'audio/opus' },
  flac: { kind: 'audio', mime: 'audio/flac' },
  mp4: { kind: 'video', mime: 'video/mp4' },
  m4v: { kind: 'video', mime: 'video/mp4' },
  webm: { kind: 'video', mime: 'video/webm' },
  mkv: { kind: 'video', mime: 'video/x-matroska' },
  mov: { kind: 'video', mime: 'video/quicktime' },
}

/** The subset of `IMPORTABLE_EXTENSIONS` that sub-phase 6.4's media pipeline handles — what a
 *  course-folder walk keeps and what the Library filters a directory import down to. */
export const MEDIA_EXTENSIONS: readonly string[] = Object.entries(EXTENSION_INFO)
  .filter(([, info]) => info.kind === 'audio' || info.kind === 'video')
  .map(([ext]) => ext)

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
