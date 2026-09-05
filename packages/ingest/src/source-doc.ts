/**
 * The parser layer's own vocabulary: what every format-specific parser in `src/parsers/`
 * produces, before 6.2's chunker turns it into `source_units`/`chunks` rows
 * (`docs/spec/05-ingestion-rag.md` §1, §4).
 *
 * `SourceDoc` itself is pipeline-internal — it is never persisted as a row, only serialized
 * whole into a blob (`docs/spec/07-architecture.md` §5, "store the raw SourceDoc JSON as a
 * blob for reprocessing"); 6.2's chunker is what turns it into `source_units`/`chunks` rows.
 * `SourceKind` is `@retenia/core`'s own enum (`packages/ingest`'s one workspace dependency),
 * not redeclared here — that redeclare-with-parity-test pattern is for leaf packages like
 * `@retenia/ipc-contract` that cannot depend on core at all.
 */
import type { SourceKind } from '@retenia/core'

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'table'
  | 'code'
  | 'figure'
  | 'equation'
  | 'caption'

/** Where a block sits in its source, for citations and for `source_units.ordinal`/`t_start`
 *  once 6.2 chunks this doc. */
export interface Locator {
  /** 1-based page or slide number. */
  page?: number
  /** `[x, y, width, height]` in PDF user-space units, when the parser knows it. */
  bbox?: [number, number, number, number]
  /** A chapter/element path (EPUB: `"<chapter-index>/<element-index>"`) or a DOM selector. */
  anchor?: string
  /** Media offset in seconds, for a transcript segment. */
  timeSec?: number
}

/** One paragraph, heading, table, figure… in reading order. */
export interface Block {
  id: string
  type: BlockType
  /** Plain text. Always populated, even for a `table`/`figure` block (a text fallback), so a
   *  consumer that only wants text never has to branch on type. */
  text: string
  /** Original markup, kept when `text` alone would lose structure a table or a rich list
   *  needs (`docs/spec/07a-schema.md`'s `chunks.locator` note on block ids). */
  html?: string
  locator: Locator
  /** sha256 of `text` — precomputed so 6.2's dedupe/idempotency does not redo it. */
  hash: string
}

/** A node in the source's outline: a PDF/DOCX heading, an EPUB chapter, a PPTX slide. */
export interface Section {
  id: string
  title: string
  /** 1 for a top-level heading/chapter/slide; deeper for a nested subheading. */
  level: number
  /** Ids into `SourceDoc.blocks`, in reading order, that this section (not its children)
   *  directly owns. */
  blocks: string[]
  children: Section[]
}

export type AssetKind = 'image' | 'thumbnail'

/** A figure, embedded image, or a rendered page/slide thumbnail — bytes the parser wrote to
 *  the blob store via `ParseContext.putAsset`, kept only by reference here. */
export interface Asset {
  id: string
  blobSha256: string
  mime: string
  kind: AssetKind
  locator?: Locator
}

export interface SourceDocMeta {
  pageCount?: number
  /** Set when at least one page/image scored low enough to need OCR (a scanned PDF page) or
   *  fell under the confidence threshold (an `image` source) — the parse itself never
   *  escalates to a cloud OCR provider; that is a later, opt-in job (`docs/spec/06-ai-providers.md`). */
  needsOcr?: boolean
  /** 1-based page numbers a PDF parse flagged as scanned (`needsOcr` is `ocrPages.length >
   *  0` for a PDF) — the per-page detail a single boolean can't carry, for whatever later
   *  step escalates specific pages to OCR. */
  ocrPages?: number[]
  /** The `image` parser's OCR confidence (0–100), when this source is an image. */
  ocrConfidence?: number
  /** Non-fatal notices a parser wants surfaced (DOCX: "N equations were not converted"). */
  warnings: string[]
  /** YAML/TOML frontmatter, for Markdown sources. */
  frontmatter?: Record<string, unknown>
}

/** What every parser in `src/parsers/` returns: one document, fully read into memory,
 *  ready to be stored as a blob and (in 6.2) chunked. */
export interface SourceDoc {
  id: string
  kind: SourceKind
  title: string
  /** BCP-47, once a parser has detected it; `null` when it has not. */
  language: string | null
  sections: Section[]
  blocks: Block[]
  assets: Asset[]
  meta: SourceDocMeta
}
