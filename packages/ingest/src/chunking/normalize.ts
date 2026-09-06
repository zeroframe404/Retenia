import type { Block, BlockType, SourceDoc } from '../source-doc'
import { ATOMIC_BLOCK_TYPES } from './types'

/**
 * The "SourceDoc normalization" half of sub-phase 6.2: every block's text laid end to end in
 * reading order, so a chunk can be described by a character range (`chunks.char_start` /
 * `char_end`) rather than by a copy of the text alone.
 *
 * Blocks keep their own text verbatim apart from line-ending normalization and trimming —
 * offsets have to survive a round trip back to the block, so this is not the place to
 * rewrite anything.
 */

/** What separates two blocks in the normalized text, and therefore what a chunk's own text
 *  uses to join the pieces it covers. */
export const BLOCK_SEPARATOR = '\n\n'

export interface NormalizedBlock {
  block: Block
  start: number
  end: number
  text: string
}

export interface NormalizedDoc {
  text: string
  blocks: NormalizedBlock[]
  byId: Map<string, NormalizedBlock>
}

function normalizeBlockText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

export function normalizeSourceDoc(doc: SourceDoc): NormalizedDoc {
  const blocks: NormalizedBlock[] = []
  const byId = new Map<string, NormalizedBlock>()
  let text = ''

  for (const block of doc.blocks) {
    const body = normalizeBlockText(block.text)
    if (body.length === 0) continue
    if (text.length > 0) text += BLOCK_SEPARATOR
    const start = text.length
    text += body
    const normalized: NormalizedBlock = { block, start, end: text.length, text: body }
    blocks.push(normalized)
    byId.set(block.id, normalized)
  }

  return { text, blocks, byId }
}

/**
 * The smallest span the chunker will move: a whole block, or — when one block is bigger than
 * a whole chunk may be — one sentence of it.
 *
 * A piece always belongs to exactly one block, so a chunk's `block_ids` is just the distinct
 * blocks of its pieces and a citation never loses track of where a sentence came from.
 */
export interface Piece {
  blockId: string
  type: BlockType
  start: number
  end: number
  text: string
  tokens: number
  /** A table, code listing, equation or figure: never subdivided, and never borrowed as
   *  overlap. */
  atomic: boolean
}

/** End of sentence: `.`, `!`, `?`, `…` or `:` followed by whitespace, plus every hard line
 *  break — a transcript or a slide has few full stops and many lines. */
const SENTENCE_END = /(?<=[.!?…:])\s+|\n+/g

/** Splits `text` into sentence spans, each relative to `text`. Every character of the input
 *  lands in exactly one span, whitespace between sentences included, so the spans still tile
 *  the original range. */
export function sentenceSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = []
  let cursor = 0
  SENTENCE_END.lastIndex = 0
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length
    if (end > cursor) {
      spans.push({ start: cursor, end })
      cursor = end
    }
  }
  if (cursor < text.length) spans.push({ start: cursor, end: text.length })
  return spans.length > 0 ? spans : [{ start: 0, end: text.length }]
}

/** Last resort for a "sentence" that is still too big — a wall of text with no punctuation.
 *  Cuts on whitespace so no word is torn in half. */
function wordSpans(
  text: string,
  from: number,
  to: number,
  maxChars: number,
): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = []
  let cursor = from
  while (to - cursor > maxChars) {
    const limit = cursor + maxChars
    const slice = text.slice(cursor, limit)
    const lastSpace = slice.lastIndexOf(' ')
    const cut = lastSpace > 0 ? cursor + lastSpace + 1 : limit
    spans.push({ start: cursor, end: cut })
    cursor = cut
  }
  if (cursor < to) spans.push({ start: cursor, end: to })
  return spans
}

export interface PieceOptions {
  countTokens: (text: string) => number
  /** A non-atomic block above this is broken into sentences. */
  maxPieceTokens: number
}

/** Turns one normalized block into the pieces the chunker moves around. */
export function blockPieces(normalized: NormalizedBlock, options: PieceOptions): Piece[] {
  const { block, start, text } = normalized
  const atomic = ATOMIC_BLOCK_TYPES.has(block.type)
  const tokens = options.countTokens(text)
  const whole: Piece = {
    blockId: block.id,
    type: block.type,
    start,
    end: normalized.end,
    text,
    tokens,
    atomic,
  }
  // An atomic block stays whole however big it is — that is the point of the rule, and it is
  // the one documented way a chunk may exceed `maxSectionTokens`.
  if (atomic || tokens <= options.maxPieceTokens) return [whole]

  const pieces: Piece[] = []
  // Characters, not tokens: the split has to happen on the string, and every counter this
  // package ships is monotonic in length, so a character budget derived from the block's own
  // ratio lands within a few percent of the token budget.
  const charsPerToken = text.length / Math.max(tokens, 1)
  const maxChars = Math.max(1, Math.floor(options.maxPieceTokens * charsPerToken))

  for (const span of sentenceSpans(text)) {
    const spans =
      span.end - span.start > maxChars ? wordSpans(text, span.start, span.end, maxChars) : [span]
    for (const piece of spans) {
      // Trimmed on both ends so a piece never carries the whitespace that separates it from
      // the next one: pieces stop tiling the block exactly, but a chunk's text is read back
      // as `normalizedText.slice(charStart, charEnd)`, which puts that whitespace back.
      const raw = text.slice(piece.start, piece.end)
      const leading = raw.length - raw.trimStart().length
      const body = raw.trim()
      if (body.length === 0) continue
      pieces.push({
        blockId: block.id,
        type: block.type,
        start: start + piece.start + leading,
        end: start + piece.start + leading + body.length,
        text: body,
        tokens: options.countTokens(body),
        atomic: false,
      })
    }
  }

  return pieces.length > 0 ? pieces : [whole]
}
