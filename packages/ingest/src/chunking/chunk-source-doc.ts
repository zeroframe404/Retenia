import type { SourceUnitKind } from '@retenia/core'
import { sha256Hex } from '../hash'
import type { Section, SourceDoc } from '../source-doc'
import { chunkKey } from './chunk-key'
import { detectFrontMatter } from './front-matter'
import {
  blockPieces,
  type NormalizedDoc,
  normalizeSourceDoc,
  type Piece,
  sentenceSpans,
} from './normalize'
import { countTokensByChars } from './tokenizer'
import { chunkTranscript, isTranscript } from './transcript'
import type {
  ChunkDraft,
  ChunkingResult,
  ChunkLocatorDraft,
  ChunkOptions,
  ChunkTokenizer,
  SourceUnitDraft,
} from './types'

/**
 * Structural chunking (`docs/spec/05-ingestion-rag.md` §4.1; `docs/spec/04-path-generation.md`
 * §3 stage 2).
 *
 * > Never cut by fixed size if there is structure: chunk = section; if > ~1,200 tokens, split
 * > by paragraphs with 10–15 % overlap; if < ~150, merge. Transcripts in 60–90 s windows.
 *
 * Pure: no clock, no ids, no I/O. The same `SourceDoc` and the same options in, byte-identical
 * `ChunkDraft[]` out, keys included — which is what lets a re-parse of an unchanged book leave
 * every embedding in place.
 *
 * **Why sections and not a sliding window.** The benchmarks in §5 of the RAG spec put a plain
 * recursive splitter within 2–3 points of the best strategy, so retrieval alone would not
 * justify this. The chunk is not only a retrieval unit here: it is what stage 7 of the
 * generation pipeline feeds a lesson writer, and what a citation resolves back to. A chunk
 * that begins mid-table or ends mid-derivation is a bad lesson and a wrong citation, which no
 * recall number pays for — hence §5's own rule, "prioritize semantic boundaries (headings)
 * over size".
 */

/** Bumped when a rule here changes the boundaries a document is cut at. Half of
 *  `chunking_version`; the tokenizer id is the other half. */
export const CHUNKING_RULES_VERSION = 1

const DEFAULTS = {
  maxSectionTokens: 1_200,
  targetChunkTokens: 400,
  minChunkTokens: 150,
  overlapRatio: 0.125,
  transcriptWindowSec: { min: 60, max: 90 },
} as const

const DEFAULT_TOKENIZER: ChunkTokenizer = { id: 'chars4', count: countTokensByChars }

/** Web pages are chunked by H2/H3: an `h4` inside a section stays with it. */
const WEB_BOUNDARY_MAX_LEVEL = 3

export function chunkingVersion(tokenizer: ChunkTokenizer): string {
  return `${CHUNKING_RULES_VERSION}:${tokenizer.id}`
}

/** Whether chunks written under `stored` were cut by the rules and tokenizer now in force —
 *  the reindex trigger of sub-phase 6.2. `null` is a chunk written before the column existed. */
export function needsRechunk(stored: string | null, current: string): boolean {
  return stored !== current
}

/** One run of blocks that becomes one or more chunks: a section's own content, plus anything
 *  folded into it (a sub-heading below `boundaryMaxLevel`, or a section too small to stand on
 *  its own). */
interface Scope {
  sectionId: string | null
  headingPath: string | null
  pieces: Piece[]
  tokens: number
  isFrontmatter: boolean
}

// --- section flattening --------------------------------------------------------------------

/** `Libro > Cap. 3 > 3.2`. Consecutive equal titles collapse, so a parser whose preamble
 *  section is named after the document does not produce `Libro > Libro`. */
function joinHeadingPath(titles: readonly string[]): string | null {
  const parts: string[] = []
  for (const title of titles) {
    const trimmed = title.trim()
    if (trimmed.length === 0) continue
    if (parts.at(-1) === trimmed) continue
    parts.push(trimmed)
  }
  return parts.length > 0 ? parts.join(' > ') : null
}

interface FlattenContext {
  doc: NormalizedDoc
  frontMatterSections: ReadonlySet<string>
  frontMatterBlocks: ReadonlySet<string>
  boundaryMaxLevel: number
  maxPieceTokens: number
  countTokens: (text: string) => number
}

/**
 * Whether a run of pieces is front matter on the strength of its own content: more than half
 * its characters come from blocks `detectFrontMatter` flagged.
 *
 * By characters and by majority, rather than "all of them". A book's opening pages are a title
 * line and then a copyright page — the copyright page gives itself away, the title line never
 * will, and they end up in the same chunk. Requiring every block would leave that chunk
 * unflagged; accepting any one block would flag the chapter that happens to quote an ISBN.
 */
function majorityFrontMatter(
  pieces: readonly Piece[],
  frontMatterBlocks: ReadonlySet<string>,
): boolean {
  let flagged = 0
  let total = 0
  for (const piece of pieces) {
    total += piece.text.length
    if (frontMatterBlocks.has(piece.blockId)) flagged += piece.text.length
  }
  return total > 0 && flagged * 2 > total
}

function piecesOf(ctx: FlattenContext, blockIds: readonly string[]): Piece[] {
  const pieces: Piece[] = []
  for (const id of blockIds) {
    const normalized = ctx.doc.byId.get(id)
    if (normalized === undefined) continue
    pieces.push(
      ...blockPieces(normalized, {
        countTokens: ctx.countTokens,
        maxPieceTokens: ctx.maxPieceTokens,
      }),
    )
  }
  return pieces
}

/** Every block a section owns, itself and through its children, in reading order — what a
 *  section folded into its ancestor contributes. */
function ownAndDescendantBlocks(section: Section, out: string[]): void {
  out.push(...section.blocks)
  for (const child of section.children) ownAndDescendantBlocks(child, out)
}

function makeScope(
  ctx: FlattenContext,
  sectionId: string | null,
  titles: readonly string[],
  blockIds: readonly string[],
  isFrontmatter: boolean,
): Scope | undefined {
  const pieces = piecesOf(ctx, blockIds)
  if (pieces.length === 0) return undefined
  return {
    sectionId,
    headingPath: joinHeadingPath(titles),
    pieces,
    tokens: pieces.reduce((sum, piece) => sum + piece.tokens, 0),
    isFrontmatter: isFrontmatter || majorityFrontMatter(pieces, ctx.frontMatterBlocks),
  }
}

/**
 * Depth-first walk producing one scope per section. A section deeper than `boundaryMaxLevel`
 * contributes its own blocks *and* its children's in one scope, which `foldDeepScopes` then
 * merges into the ancestor that did open a boundary — how "web pages by H2/H3" is expressed.
 */
function flattenSections(ctx: FlattenContext, doc: SourceDoc): Scope[] {
  const scopes: Scope[] = []

  const visit = (section: Section, ancestors: readonly string[], inFrontMatter: boolean): void => {
    const titles = [...ancestors, section.title]
    const isFrontmatter = inFrontMatter || ctx.frontMatterSections.has(section.id)

    if (section.level > ctx.boundaryMaxLevel) {
      const blockIds: string[] = []
      ownAndDescendantBlocks(section, blockIds)
      const folded = makeScope(ctx, section.id, titles, blockIds, isFrontmatter)
      if (folded !== undefined) scopes.push(folded)
      return
    }

    const scope = makeScope(ctx, section.id, titles, section.blocks, isFrontmatter)
    if (scope !== undefined) scopes.push(scope)
    for (const child of section.children) visit(child, titles, isFrontmatter)
  }

  for (const root of doc.sections) visit(root, [doc.title], false)
  return scopes
}

/** Merges the scopes `flattenSections` emitted for sections below `boundaryMaxLevel` into the
 *  scope that precedes them. */
function foldDeepScopes(scopes: Scope[], doc: SourceDoc, boundaryMaxLevel: number): Scope[] {
  if (boundaryMaxLevel === Number.POSITIVE_INFINITY) return scopes
  const levelById = new Map<string, number>()
  const walk = (section: Section): void => {
    levelById.set(section.id, section.level)
    for (const child of section.children) walk(child)
  }
  for (const root of doc.sections) walk(root)

  const folded: Scope[] = []
  for (const scope of scopes) {
    const level = scope.sectionId === null ? 0 : (levelById.get(scope.sectionId) ?? 0)
    const previous = folded.at(-1)
    if (level > boundaryMaxLevel && previous !== undefined) {
      previous.pieces.push(...scope.pieces)
      previous.tokens += scope.tokens
      // The parent's verdict stands. A sub-heading folded into a table of contents is still
      // part of that table of contents, and combining the two flags either way would let an
      // unremarkable `h4` un-flag the section that contains it.
      continue
    }
    folded.push(scope)
  }
  return folded
}

/**
 * "If < ~150, merge." A scope too small to be a chunk joins the one after it, keeping the
 * heading path it starts under. Two things stop a merge: crossing the front-matter boundary
 * (which would hide a table of contents inside a chapter, or the reverse), and a combined size
 * over `maxSectionTokens` — a merge that immediately forces a split has only moved the problem
 * and mislabelled the tail.
 */
function mergeSmallScopes(scopes: readonly Scope[], min: number, max: number): Scope[] {
  const merged: Scope[] = []
  let pending: Scope | undefined

  for (const scope of scopes) {
    if (pending === undefined) {
      pending = { ...scope, pieces: [...scope.pieces] }
      continue
    }
    const mergeable =
      pending.tokens < min &&
      pending.isFrontmatter === scope.isFrontmatter &&
      pending.tokens + scope.tokens <= max
    if (mergeable) {
      pending.pieces.push(...scope.pieces)
      pending.tokens += scope.tokens
      continue
    }
    merged.push(pending)
    pending = { ...scope, pieces: [...scope.pieces] }
  }

  if (pending !== undefined) merged.push(pending)
  return merged
}

// --- splitting -----------------------------------------------------------------------------

/** The pieces of one chunk, before it gets a key and an ordinal. */
type PieceRun = Piece[]

function runTokens(run: PieceRun): number {
  return run.reduce((sum, piece) => sum + piece.tokens, 0)
}

/**
 * The tail of `piece` that fits in `budget` tokens, cut at a sentence boundary where there is
 * one and at a word boundary where there is not, as a piece of its own.
 *
 * Without this the overlap would usually be empty: a paragraph of a real book runs 80–150
 * tokens and the budget is 10–15 % of 400, so no *whole* paragraph fits and the greedy loop
 * below would hand back nothing. Cutting the tail at a sentence boundary keeps the overlap the
 * size §4 asks for and keeps it readable, which is the point of having one — the next chunk
 * opens on the sentence the previous one closed on, so a passage that straddles the boundary is
 * retrievable from either side.
 */
function overlapTail(
  piece: Piece,
  budget: number,
  countTokens: (text: string) => number,
): Piece | undefined {
  if (piece.atomic || budget <= 0) return undefined
  const spans = sentenceSpans(piece.text)
  let start: number | undefined
  let tokens = 0
  for (let index = spans.length - 1; index >= 0; index -= 1) {
    const span = spans[index] as { start: number; end: number }
    const text = piece.text.slice(span.start, span.end).trim()
    if (text.length === 0) continue
    const cost = countTokens(text)
    if (tokens + cost > budget) break
    start = span.start
    tokens += cost
  }
  if (start === undefined || start === 0) {
    // No sentence boundary inside the budget — a wall of text, or a slide bullet with no full
    // stop. Cut on a word boundary instead: a slightly ragged overlap is worth more than none.
    const chars = Math.max(1, Math.floor((budget * piece.text.length) / Math.max(piece.tokens, 1)))
    if (chars >= piece.text.length) return undefined
    const from = piece.text.length - chars
    const space = piece.text.indexOf(' ', from)
    if (space <= 0 || space >= piece.text.length - 1) return undefined
    start = space + 1
  }
  const raw = piece.text.slice(start)
  const leading = raw.length - raw.trimStart().length
  const text = raw.trim()
  if (text.length === 0) return undefined
  return {
    blockId: piece.blockId,
    type: piece.type,
    start: piece.start + start + leading,
    end: piece.start + start + leading + text.length,
    text,
    tokens: countTokens(text),
    atomic: false,
  }
}

/**
 * The tail of `run`, up to `budget` tokens, as the seed of the next chunk — §4's 10–15 %
 * overlap. Atomic pieces are never borrowed: repeating a whole table in the next chunk buys no
 * continuity and costs its full size twice.
 */
function overlapSeed(
  run: PieceRun,
  budget: number,
  countTokens: (text: string) => number,
): PieceRun {
  if (budget <= 0) return []
  const seed: PieceRun = []
  let tokens = 0
  for (let index = run.length - 1; index >= 0; index -= 1) {
    const piece = run[index] as Piece
    if (piece.atomic) break
    if (tokens + piece.tokens > budget) {
      // Nothing whole fits yet: fall back to the tail of this piece, but only for the piece
      // the chunk actually ends on — borrowing sentences out of the middle of a run would
      // leave a hole between the overlap and the rest.
      if (seed.length > 0) break
      const tail = overlapTail(piece, budget, countTokens)
      if (tail !== undefined) seed.unshift(tail)
      break
    }
    seed.unshift(piece)
    tokens += piece.tokens
  }
  // Repeating the whole chunk would make the next one a superset of it, not an overlap.
  return seed.length === run.length ? seed.slice(1) : seed
}

interface SplitOptions {
  /** The band a split chunk aims for: 300–500 tokens around a 400-token target. */
  bandMin: number
  bandMax: number
  max: number
  min: number
  overlapTokens: number
  countTokens: (text: string) => number
}

/**
 * Greedy accumulation over pieces, aiming at the band rather than at a single number: a run
 * closes at the last boundary that still leaves it inside 300–500 tokens.
 *
 * Closing at "the first boundary past 400" — the obvious rule — reads the spec's *target* and
 * ignores its *range*: a section of 300-token paragraphs would produce 600-token chunks,
 * because 300 is under 400 and adding the next one is still under the 1,200 ceiling. Closing
 * at the last boundary inside the band produces 300 and 300 instead, which is what §4 asks
 * for and what the retrieval benchmarks in §5 were measured on.
 *
 * The band is a preference, not a guarantee: paragraphs are indivisible here, so one that is
 * bigger than the band on its own overshoots it, and a run still short of `bandMin` takes the
 * next piece whatever size it is rather than emit a chunk nobody asked for.
 */
function splitScope(scope: Scope, options: SplitOptions): PieceRun[] {
  if (scope.tokens <= options.max) return [scope.pieces]

  const runs: PieceRun[] = []
  let current: PieceRun = []
  let tokens = 0

  const flush = (): void => {
    if (current.length === 0) return
    runs.push(current)
    const seed = overlapSeed(current, options.overlapTokens, options.countTokens)
    current = [...seed]
    tokens = runTokens(seed)
  }

  for (const piece of scope.pieces) {
    const wouldLeaveTheBand = tokens >= options.bandMin && tokens + piece.tokens > options.bandMax
    const wouldBreakTheCeiling = tokens + piece.tokens > options.max
    if (current.length > 0 && (wouldLeaveTheBand || wouldBreakTheCeiling)) flush()
    current.push(piece)
    tokens += piece.tokens
  }
  if (current.length > 0) runs.push(current)

  // A tail left under `min` by the last flush goes back into the chunk before it, when that one
  // has room. When it does not, the tail stays — and it is the last chunk of its section, which
  // is the one place the 150-token floor does not apply.
  const last = runs.at(-1)
  const previous = runs.at(-2)
  if (runs.length > 1 && last !== undefined && previous !== undefined) {
    if (runTokens(last) < options.min) {
      const withoutOverlap = last.filter((piece) => !previous.includes(piece))
      if (runTokens(previous) + runTokens(withoutOverlap) <= options.max) {
        previous.push(...withoutOverlap)
        runs.pop()
      }
    }
  }

  return runs
}

// --- units ---------------------------------------------------------------------------------

interface UnitPlan {
  units: SourceUnitDraft[]
  /** Which unit a block belongs to. */
  unitKeyByBlock: Map<string, string>
}

const PAGED_KINDS: Partial<Record<SourceDoc['kind'], SourceUnitKind>> = {
  pdf: 'page',
  pptx: 'slide',
  // A standalone image (`parsers/image.ts`) always carries exactly one block, at `page: 1` —
  // a trivial one-page document, but a real one: without this the chunk built from it would
  // carry no `locator.page` at all, since `buildChunk` only ever copies a unit's ordinal.
  image: 'page',
}

function pageLabel(kind: SourceUnitKind, ordinal: number): string {
  return kind === 'slide' ? `Slide ${ordinal}` : `p. ${ordinal}`
}

/** Pages and slides: one unit per `locator.page`, carrying that page's text. */
function planPagedUnits(doc: SourceDoc, kind: SourceUnitKind): UnitPlan {
  const byPage = new Map<number, { blockIds: string[]; texts: string[] }>()
  const unitKeyByBlock = new Map<string, string>()

  for (const block of doc.blocks) {
    const page = block.locator.page
    if (page === undefined) continue
    let entry = byPage.get(page)
    if (entry === undefined) {
      entry = { blockIds: [], texts: [] }
      byPage.set(page, entry)
    }
    entry.blockIds.push(block.id)
    if (block.text.length > 0) entry.texts.push(block.text)
    unitKeyByBlock.set(block.id, `${kind}:${page}`)
  }

  const units = [...byPage.entries()]
    .sort(([left], [right]) => left - right)
    .map(([page, entry]) => ({
      key: `${kind}:${page}`,
      kind,
      ordinal: page,
      label: pageLabel(kind, page),
      tStartMs: null,
      tEndMs: null,
      text: entry.texts.length > 0 ? entry.texts.join('\n') : null,
      blockIds: entry.blockIds,
    }))

  return { units, unitKeyByBlock }
}

/** Everything else: one `section` unit per chunk boundary, so a citation can still open the
 *  document at the right heading. */
function planSectionUnits(scopes: readonly Scope[], doc: NormalizedDoc): UnitPlan {
  const units: SourceUnitDraft[] = []
  const unitKeyByBlock = new Map<string, string>()

  scopes.forEach((scope, index) => {
    const key = `section:${scope.sectionId ?? index}`
    const blockIds: string[] = []
    const texts: string[] = []
    for (const piece of scope.pieces) {
      if (unitKeyByBlock.has(piece.blockId)) continue
      unitKeyByBlock.set(piece.blockId, key)
      blockIds.push(piece.blockId)
      const normalized = doc.byId.get(piece.blockId)
      if (normalized !== undefined) texts.push(normalized.text)
    }
    if (blockIds.length === 0) return
    units.push({
      key,
      kind: 'section',
      ordinal: index + 1,
      label: scope.headingPath?.split(' > ').at(-1) ?? null,
      tStartMs: null,
      tEndMs: null,
      text: texts.length > 0 ? texts.join('\n\n') : null,
      blockIds,
    })
  })

  return { units, unitKeyByBlock }
}

// --- assembly ------------------------------------------------------------------------------

function distinctBlockIds(run: PieceRun): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const piece of run) {
    if (seen.has(piece.blockId)) continue
    seen.add(piece.blockId)
    ids.push(piece.blockId)
  }
  return ids
}

/** `selector` is only meaningful where the parser produced a document-order anchor. */
const ANCHOR_KINDS: ReadonlySet<SourceDoc['kind']> = new Set(['epub', 'web'])

interface BuildContext {
  sourceId: string
  doc: SourceDoc
  normalized: NormalizedDoc
  unitKeyByBlock: Map<string, string>
  unitsByKey: Map<string, SourceUnitDraft>
  countTokens: (text: string) => number
  frontMatterBlocks: ReadonlySet<string>
}

function buildChunk(ctx: BuildContext, scope: Scope, run: PieceRun, ordinal: number): ChunkDraft {
  const charStart = Math.min(...run.map((piece) => piece.start))
  const charEnd = Math.max(...run.map((piece) => piece.end))
  const text = ctx.normalized.text.slice(charStart, charEnd)
  const blockIds = distinctBlockIds(run)
  const firstBlockId = blockIds[0] as string
  const unitKey = ctx.unitKeyByBlock.get(firstBlockId) ?? null
  const unit = unitKey === null ? undefined : ctx.unitsByKey.get(unitKey)
  const anchor = ANCHOR_KINDS.has(ctx.doc.kind)
    ? ctx.normalized.byId.get(firstBlockId)?.block.locator.anchor
    : undefined

  const locator: ChunkLocatorDraft = { block_ids: blockIds }
  if (unit !== undefined && (unit.kind === 'page' || unit.kind === 'slide')) {
    locator.page = unit.ordinal
  }
  if (unit?.label != null) locator.label = unit.label
  if (anchor !== undefined) locator.selector = anchor

  return {
    key: chunkKey(ctx.sourceId, blockIds, text),
    ordinal,
    text,
    tokenCount: ctx.countTokens(text),
    charStart,
    charEnd,
    hash: sha256Hex(text),
    headingPath: scope.headingPath,
    blockIds,
    unitKey,
    sectionId: scope.sectionId,
    // A chunk is front matter when the section it came from is, or when its own text is
    // mostly flagged blocks — a chunk that merely *touches* one is still content.
    isFrontmatter: scope.isFrontmatter || majorityFrontMatter(run, ctx.frontMatterBlocks),
    locator,
  }
}

export function chunkSourceDoc(doc: SourceDoc, options: ChunkOptions): ChunkingResult {
  const tokenizer = options.tokenizer ?? DEFAULT_TOKENIZER
  const countTokens = tokenizer.count
  const maxSectionTokens = options.maxSectionTokens ?? DEFAULTS.maxSectionTokens
  const targetChunkTokens = options.targetChunkTokens ?? DEFAULTS.targetChunkTokens
  const minChunkTokens = options.minChunkTokens ?? DEFAULTS.minChunkTokens
  const overlapRatio = options.overlapRatio ?? DEFAULTS.overlapRatio
  const boundaryMaxLevel =
    options.boundaryMaxLevel ??
    (doc.kind === 'web' ? WEB_BOUNDARY_MAX_LEVEL : Number.POSITIVE_INFINITY)

  const normalized = normalizeSourceDoc(doc)
  const warnings: string[] = []
  const version = chunkingVersion(tokenizer)

  if (normalized.blocks.length === 0) {
    return { units: [], chunks: [], chunkingVersion: version, normalizedText: '', warnings }
  }

  const frontMatter = detectFrontMatter(doc)

  if (isTranscript(doc)) {
    return chunkTranscript(doc, normalized, {
      sourceId: options.sourceId,
      countTokens,
      chunkingVersion: version,
      window: options.transcriptWindowSec ?? DEFAULTS.transcriptWindowSec,
      maxSectionTokens,
      frontMatterBlocks: frontMatter.blockIds,
    })
  }

  const ctx: FlattenContext = {
    doc: normalized,
    frontMatterSections: frontMatter.sectionIds,
    frontMatterBlocks: frontMatter.blockIds,
    boundaryMaxLevel,
    // A non-atomic block bigger than a whole chunk may be is cut into sentences. Without this
    // the band is a wish: a PDF page that the parser emitted as one 900-token block would be
    // one 900-token chunk, since the greedy loop below can only cut *between* pieces.
    maxPieceTokens: Math.round(targetChunkTokens * 1.25),
    countTokens,
  }

  const flattened = foldDeepScopes(flattenSections(ctx, doc), doc, boundaryMaxLevel)
  const scopes = mergeSmallScopes(flattened, minChunkTokens, maxSectionTokens)

  const pagedKind = PAGED_KINDS[doc.kind]
  const plan =
    pagedKind !== undefined && doc.blocks.some((block) => block.locator.page !== undefined)
      ? planPagedUnits(doc, pagedKind)
      : planSectionUnits(scopes, normalized)
  const unitsByKey = new Map(plan.units.map((unit) => [unit.key, unit]))

  const splitOptions: SplitOptions = {
    // ±25 % of the target is exactly §4's 300–500 band for the 400-token default.
    bandMin: Math.round(targetChunkTokens * 0.75),
    bandMax: Math.round(targetChunkTokens * 1.25),
    max: maxSectionTokens,
    min: minChunkTokens,
    overlapTokens: Math.round(targetChunkTokens * overlapRatio),
    countTokens,
  }

  const buildContext: BuildContext = {
    sourceId: options.sourceId,
    doc,
    normalized,
    unitKeyByBlock: plan.unitKeyByBlock,
    unitsByKey,
    countTokens,
    frontMatterBlocks: frontMatter.blockIds,
  }

  const chunks: ChunkDraft[] = []
  for (const scope of scopes) {
    for (const run of splitScope(scope, splitOptions)) {
      if (run.length === 0) continue
      chunks.push(buildChunk(buildContext, scope, run, chunks.length))
    }
  }

  const covered = new Set(chunks.flatMap((chunk) => chunk.blockIds))
  const missing = normalized.blocks.filter((block) => !covered.has(block.block.id))
  if (missing.length > 0) {
    warnings.push(`${missing.length} block(s) were not covered by any chunk`)
  }

  return {
    units: plan.units,
    chunks,
    chunkingVersion: version,
    normalizedText: normalized.text,
    warnings,
  }
}
