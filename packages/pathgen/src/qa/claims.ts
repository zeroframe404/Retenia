import { isSubstantive, type TheoryBlock } from '../schemas/lesson'

/**
 * Sentences as units of verification.
 *
 * §5 gate 3 scores *claims*, and §4 puts one citation "at the end of the sentence it
 * supports" — so a claim is a sentence of a substantive block, and the ids that sentence
 * carries are what it may be checked against. A sentence with no marker of its own inherits
 * the block's sibling list: P3 is allowed to cite a whole block in the `citations` array
 * and write the paragraph marker-free, and `resolveCitations` keeps both statements.
 *
 * The splitter is deliberately conservative. It cuts at `.`, `!`, `?` and `…` only when
 * whitespace (or the end) follows — so `3.5` inside a sentence does not split — and at every
 * line break, because a bullet or a "Typical error: …" line is a claim of its own. A
 * `[cite:…]` marker that follows the terminal punctuation stays with the sentence it ends,
 * which is the house style P3's few-shots teach.
 *
 * Segments cover the block's text exactly, in order, so a gate that wants to rewrite one
 * sentence — strip its markers, say — can rebuild the block from the segments and touch
 * nothing else.
 */

/** `[cite:B03]`, `[cite: B03]`, `[cite:B03, B04]` — the same pattern `expand/citations.ts` reads. */
export const CITE_MARKER = /\[cite:\s*([^\]]+)\]/g

/** Shorter than this after the markers are stripped, a segment is punctuation or a label, not a claim. */
export const MIN_CLAIM_CHARS = 20

export interface Segment {
  /** The exact slice of the block, markers and trailing whitespace included. */
  readonly text: string
  /** The sentence with its markers removed and its whitespace collapsed. */
  readonly sentence: string
  /** The cite ids the segment carries inline, in order of first appearance. */
  readonly citationIds: readonly string[]
}

export function citeIdsIn(text: string): string[] {
  const ids: string[] = []
  for (const match of text.matchAll(CITE_MARKER)) {
    for (const id of (match[1] as string).split(/[,\s]+/)) {
      if (id !== '' && !ids.includes(id)) ids.push(id)
    }
  }
  return ids
}

/** The spaces a removed marker leaves behind: doubled, or in front of the punctuation. */
function tidy(text: string): string {
  return text.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,;:!?…])/g, '$1')
}

/** The text without its markers, whitespace collapsed. */
export function stripMarkers(text: string): string {
  return tidy(text.replace(CITE_MARKER, '')).trim()
}

/** Every occurrence of `ids` removed from the markers of `text`; an emptied marker goes too. */
export function removeCiteIds(text: string, ids: ReadonlySet<string>): string {
  return tidy(
    text.replace(CITE_MARKER, (_marker, list: string) => {
      const kept = list.split(/[,\s]+/).filter((id) => id !== '' && !ids.has(id))
      return kept.length === 0 ? '' : `[cite:${kept.join(', ')}]`
    }),
  )
}

const SENTENCE_END = /[.!?…]+[»"”)\]]*(?:\s*\[cite:\s*[^\]]*\])*(?=\s|$)/gu
const LINE_BREAK = /\n+/g

/** The block's text cut into sentences that concatenate back to it exactly. */
export function segmentSentences(content: string): Segment[] {
  const boundaries = new Set<number>()
  for (const match of content.matchAll(SENTENCE_END)) {
    let end = match.index + match[0].length
    // The whitespace after the terminal punctuation belongs to the sentence it closes, so a
    // rebuilt block keeps its spacing and a line break stays where it was.
    while (end < content.length && /\s/.test(content[end] as string)) end += 1
    boundaries.add(end)
  }
  for (const match of content.matchAll(LINE_BREAK)) boundaries.add(match.index + match[0].length)
  boundaries.add(content.length)

  const segments: Segment[] = []
  let start = 0
  for (const end of [...boundaries].sort((a, b) => a - b)) {
    if (end <= start) continue
    const text = content.slice(start, end)
    segments.push({ text, sentence: stripMarkers(text), citationIds: citeIdsIn(text) })
    start = end
  }
  return segments
}

export interface Claim {
  /** `c01`, `c02`, … — the id the task shows P6 and the answer comes back under. */
  readonly id: string
  readonly blockIndex: number
  /** Which segment of the block, so a verdict can be applied to exactly that sentence. */
  readonly segmentIndex: number
  readonly sentence: string
  /** The segment's own markers, or the block's sibling list when it carries none. */
  readonly citationIds: readonly string[]
  /** Whether the ids came from the sentence itself rather than from the block. */
  readonly ownCitations: boolean
}

export function claimId(index: number): string {
  return `c${String(index + 1).padStart(2, '0')}`
}

/**
 * The claims of a lesson: every sentence of a substantive block that has a citation to be
 * checked against. Uncited sentences of a cited block inherit the block's ids; a
 * `general_knowledge` block has none by definition and contributes nothing.
 */
export function extractClaims(blocks: readonly TheoryBlock[]): Claim[] {
  const claims: Claim[] = []
  for (const [blockIndex, block] of blocks.entries()) {
    if (!isSubstantive(block.type)) continue
    const sibling = block.citations
    for (const [segmentIndex, segment] of segmentSentences(block.content).entries()) {
      if (segment.sentence.length < MIN_CLAIM_CHARS) continue
      const own = segment.citationIds.length > 0
      const citationIds = own ? segment.citationIds : sibling
      if (citationIds.length === 0) continue
      claims.push({
        id: claimId(claims.length),
        blockIndex,
        segmentIndex,
        sentence: segment.sentence,
        citationIds: [...citationIds],
        ownCitations: own,
      })
    }
  }
  return claims
}

/** One block with the markers of one of its sentences removed; the rest byte-identical. */
export function stripSegmentMarkers(content: string, segmentIndex: number): string {
  return segmentSentences(content)
    .map((segment, index) =>
      index === segmentIndex ? tidy(segment.text.replace(CITE_MARKER, '')) : segment.text,
    )
    .join('')
}
