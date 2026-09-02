import type { Entity, JsonObject } from './_common'
import type { AnnotationKind, SourceKind, SourceStatus, SourceUnitKind } from './enums'

/** The source library: what the user loads, how it is split for citation and retrieval, and
 *  what they mark on it (`docs/spec/07a-schema.md` "Source library"). */

/**
 * A file the app holds, content-addressed by sha256. The bytes live on disk under
 * `userData/blobs/<sha[0:2]>/<sha>.<ext>` — this row is only the index.
 */
export interface Blob extends Entity {
  sha256: string
  mime: string
  bytes: number
  ext: string | null
  originalName: string | null
  meta: JsonObject | null
}

/** A book, video, page… — one thing the user loaded. */
export interface Source extends Entity {
  kind: SourceKind
  title: string
  originUri: string | null
  blobSha256: string | null
  status: SourceStatus
  language: string | null
  meta: JsonObject | null
  error: string | null
  ingestedAt: Date | null
}

/** A citable subdivision of a source: a page, a slide, a transcript segment, a keyframe. */
export interface SourceUnit extends Entity {
  sourceId: string
  kind: SourceUnitKind
  ordinal: number
  label: string | null
  /** Media offsets in milliseconds; null for paged sources. */
  tStart: number | null
  tEnd: number | null
  text: string | null
  blobSha256: string | null
  meta: JsonObject | null
}

/** A retrieval-sized slice of a source's text, the unit both FTS5 and the vector index hold. */
export interface Chunk extends Entity {
  sourceId: string
  unitId: string | null
  ordinal: number
  text: string
  charStart: number
  charEnd: number
  tokenCount: number
  /** sha256 of `text`, so re-ingesting an unchanged source is a no-op. */
  hash: string
  headingPath: string | null
  context: string | null
  locator: JsonObject | null
}

/** A highlight, note, region or clip the user made on a source. */
export interface Annotation extends Entity {
  sourceId: string
  unitId: string | null
  kind: AnnotationKind
  /** Rects, an EPUB CFI or a time range — whatever pins the mark to the document. */
  anchor: JsonObject
  quote: string | null
  note: string | null
  color: string | null
  /** Media offsets in seconds (fractional), for `clip` annotations. */
  tStart: number | null
  tEnd: number | null
}
