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

/**
 * Where a chunk (or a knowledge item) sits inside its source, in the shape retrieval hands
 * back to the tutor and the citation UI: a page for paged sources, a millisecond range for
 * media, and the ids of the blocks the span covers (`chunk_id → block_ids`,
 * `docs/spec/05-ingestion-rag.md` §4).
 *
 * The stored form is the `locator` JSON column, whose canonical keys are snake_case
 * (`t_start`, `t_end`, `block_ids`); `parseSourceLocator` is the one place that reads it.
 */
export interface SourceLocator {
  /** The `source_units` row to open — the page, slide or transcript segment. */
  unitId: string | null
  /** 1-based page or slide number, for paged sources. */
  page: number | null
  /** Media offsets in milliseconds, for audio and video ("jump to the minute"). */
  tStartMs: number | null
  tEndMs: number | null
  /** Human label as it is shown in a citation: `p. 112`, `Slide 4`, `12:30`. */
  label: string | null
  /** A DOM/EPUB selector for web and EPUB sources, when the parser produced one. */
  selector: string | null
  /** The editor block ids the chunk covers, for exact citations back into a note. */
  blockIds: readonly string[]
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
