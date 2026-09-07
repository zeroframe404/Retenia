import type { SourceUnitKind } from '@retenia/core'
import type { BlockType } from '../source-doc'
import type { TokenCounter, TokenizerId } from './tokenizer'

/**
 * What `chunkSourceDoc` produces: the `source_units` and `chunks` rows a `SourceDoc` becomes
 * (`docs/spec/05-ingestion-rag.md` §4; `docs/spec/07a-schema.md`, "Source library").
 *
 * Drafts, not entities: this package is pure and has no `IdGenerator`, no clock and no
 * database, so nothing here carries a UUIDv7 or an audit column. The persistence layer
 * (`apps/desktop/src/main/library/chunk-store.ts`) turns a draft into a row, and matches a
 * re-chunked draft to the row it replaces by `key`.
 */

/** A page, slide, section or transcript window: the citable unit a chunk points back to. */
export interface SourceUnitDraft {
  /**
   * Stable within one document: `page:12`, `slide:4`, `section:<section id>`, `segment:3`.
   * It is what a chunk names in `unitKey`, and what the store matches against the units it
   * already has, so a re-chunk keeps the annotations anchored to a page.
   */
  key: string
  kind: SourceUnitKind
  ordinal: number
  label: string | null
  /** Media offsets in **milliseconds** (`source_units.t_start`/`t_end`). */
  tStartMs: number | null
  tEndMs: number | null
  text: string | null
  blockIds: readonly string[]
  /** The image this unit stands for, when it is one — a video keyframe (sub-phase 6.4).
   *  `source_units.blob_sha256`, and what keeps the frame's blob referenced so a GC pass does
   *  not collect a picture the player is still drawing a marker for. */
  blobSha256?: string | null
}

/** The `chunks.locator` JSON column. Keys are snake_case because `parseSourceLocator` in
 *  `@retenia/core` is the one reader and that is the shape it reads. */
export interface ChunkLocatorDraft {
  page?: number
  t_start?: number
  t_end?: number
  label?: string
  selector?: string
  block_ids: string[]
}

export interface ChunkDraft {
  /**
   * `sha256(source_id, block_ids, text)` — the chunk's identity, and the acceptance
   * criterion "chunk ids are stable across runs": re-chunking an unchanged, already-persisted
   * `SourceDoc` produces the same keys, so the store can leave those rows (and their
   * embeddings) alone.
   *
   * That stability does not reach across a genuine re-parse: block ids come from
   * `ParseContext.id()`, a fresh UUIDv7 per parser call, so re-parsing the same source file
   * (`library.retry`) mints new block ids and therefore new keys even for byte-identical
   * text — see `@retenia/db`'s `ChunkRepository.replaceBySource` for what that costs.
   *
   * The row's `id` is still a UUIDv7 like every other row; this is a natural key stored
   * beside it in `chunks.chunk_key`.
   */
  key: string
  ordinal: number
  text: string
  tokenCount: number
  /** Offsets into `ChunkingResult.normalizedText`. */
  charStart: number
  charEnd: number
  /** sha256 of `text` alone — `chunks.hash`, the embedding job's idempotency key. */
  hash: string
  /** `Libro > Cap. 3 > 3.2`. */
  headingPath: string | null
  /** Every block the chunk covers, whole or in part — `chunk_id → block_ids`, what makes a
   *  citation exact. */
  blockIds: readonly string[]
  /** The `SourceUnitDraft.key` this chunk opens at, or `null` when the source has no units. */
  unitKey: string | null
  /** The section the chunk came from; `null` for a transcript window, which is bounded by
   *  time rather than by structure. */
  sectionId: string | null
  /** Table of contents, copyright page, index, bibliography… (`chunks.is_frontmatter`).
   *  Flagged, never dropped — stage 4 of the generation pipeline excludes them. */
  isFrontmatter: boolean
  locator: ChunkLocatorDraft
}

export interface ChunkingResult {
  units: SourceUnitDraft[]
  chunks: ChunkDraft[]
  /** `<rules version>:<tokenizer id>` — what `chunks.chunking_version` stores, and what
   *  `needsRechunk` compares against. */
  chunkingVersion: string
  /** Every block's text joined in reading order: what `charStart`/`charEnd` index into. */
  normalizedText: string
  warnings: string[]
}

/** The tokenizer, as one value so its id and its counter cannot drift apart. */
export interface ChunkTokenizer {
  id: TokenizerId
  count: TokenCounter
}

export interface ChunkOptions {
  /** The `sources.id` these chunks belong to — part of every chunk key. */
  sourceId: string
  /** Defaults to the `chars4` heuristic (see `tokenizer.ts`). */
  tokenizer?: ChunkTokenizer
  /** A section at or below this size is one chunk. Default 1,200. */
  maxSectionTokens?: number
  /** The middle of the band a split section aims for per chunk: the band is ±25 % of it, so
   *  the default 400 is §4's 300–500. */
  targetChunkTokens?: number
  /** Below this a section is merged into the next one. Default 150. */
  minChunkTokens?: number
  /** Fraction of `targetChunkTokens` repeated from the previous chunk. Default 0.125. */
  overlapRatio?: number
  /** Headings deeper than this do not open a chunk of their own — their content stays with
   *  the nearest ancestor. Default: unlimited; 3 for web pages (H2/H3). */
  boundaryMaxLevel?: number
  /** Transcript windows, in seconds. Default 60–90. */
  transcriptWindowSec?: { min: number; max: number }
}

/** Block types that are never cut: a table split down the middle is two useless chunks, and
 *  half a code listing does not compile (`docs/spec/04-path-generation.md` §14, pitfall 5). */
export const ATOMIC_BLOCK_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  'table',
  'code',
  'equation',
  'figure',
])
