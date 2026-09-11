import { isSubstantive, type LessonCitation, type TheoryBlock } from '../../schemas/lesson'
import { warning } from '../../schemas/warnings'
import { citeIdsIn, removeCiteIds, segmentSentences } from '../claims'
import { quotedSpans, SPAN_SIMILARITY_THRESHOLD, spanSimilarity } from '../fuzzy'
import type { QaFinding } from '../lesson-qa'
import { clip, type GateResult, gateResult } from './types'

/**
 * Gate (b) — §5 gate 2: *"Valid citations: the cited span exists, fuzzy ≥ 0.85."*
 *
 * Two checks, and what each one does to the block when it fails.
 *
 * **Every id resolves.** A marker or a sibling id that names no entry of `lessons.citations`
 * is removed, the way `resolveCitations` already removes ids that named no fragment. It is
 * rare after stage 7 — `resolveCitations` is what writes both — and it is checked here
 * because this gate runs over the *stored* row, which anything could have touched.
 *
 * **Every quoted span is in the source.** A sentence that quotes a passage («…», "…") and
 * cites a fragment is claiming the passage is *there*. The quote is matched against the
 * **full text of the cited chunk** — not the head P3 was shown, which is how a chunk cut at
 * `MAX_CHUNK_CHARS` left a gap in stage 7's acceptance property (`lesson_fragment_truncated`)
 * — at §5's 0.85 over Damerau-Levenshtein. A span nothing cited contains loses the markers of
 * its sentence, the sentence is flagged, and a substantive block left without a citation is
 * retyped `general_knowledge` (the fidelity contract's own name for an uncited claim, and the
 * same rule `expand/citations.ts` applies). A span that matches upgrades `citation.quote`,
 * which until now was stored only when the quote was verbatim.
 *
 * Nothing here decides whether a *paraphrase* is supported: that is gate 3's question and a
 * model's job. This gate is the mechanical half — ids and quotations — so the model only ever
 * judges claims whose references are real.
 */

export interface CitationGateInput {
  readonly lessonSpecId: string
  readonly blocks: readonly TheoryBlock[]
  readonly citations: readonly LessonCitation[]
  /** The full text of every cited chunk, by chunk id. A chunk that is absent cannot be checked and is left alone. */
  readonly chunkText: ReadonlyMap<string, string>
}

export interface CitationGateResult extends GateResult {
  readonly blocks: readonly TheoryBlock[]
  readonly citations: readonly LessonCitation[]
  /** Substantive blocks retyped to `general_knowledge` for having lost their last citation. */
  readonly retyped: number
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)]
}

export function checkCitations(input: CitationGateInput): CitationGateResult {
  const byId = new Map(input.citations.map((citation) => [citation.id, citation]))
  const findings: QaFinding[] = []
  const bestQuote = new Map<string, string>()
  const used = new Set<string>()
  let stripped = false
  let retyped = 0

  const blocks = input.blocks.map((block, blockIndex): TheoryBlock => {
    // 1. Ids that resolve to nothing, wherever they appear.
    const unknown = new Set(
      unique([...citeIdsIn(block.content), ...block.citations]).filter((id) => !byId.has(id)),
    )
    let content = block.content
    let sibling = block.citations.filter((id) => !unknown.has(id))
    if (unknown.size > 0) {
      content = removeCiteIds(content, unknown)
      stripped = true
      findings.push({
        gate: 'citations',
        kind: 'citation_missing',
        block_index: blockIndex,
        sentence: clip(content),
        citation_ids: [...unknown].sort(),
        detail: 'cited ids that resolve to no source',
      })
    }

    // 2. Quoted spans, sentence by sentence, against the full chunk text.
    const struck = new Set<string>()
    const segments = segmentSentences(content)
    const rebuilt = segments.map((segment) => {
      const own = segment.citationIds.length > 0
      const ids = own ? segment.citationIds : sibling
      if (ids.length === 0) return segment.text
      let invalid = false
      for (const span of quotedSpans(segment.sentence)) {
        let best: { id: string; similarity: number } | null = null
        for (const id of ids) {
          const citation = byId.get(id)
          /* c8 ignore next -- every id here resolves: the unknown ones were removed from the
             content and from the sibling list before the sentences were cut. Kept as a guard
             rather than a cast, because a marker the regex reads is text a model wrote. */
          if (citation === undefined) continue
          const text = input.chunkText.get(citation.chunk_id)
          if (text === undefined) continue
          const similarity = spanSimilarity(span, text)
          if (best === null || similarity > best.similarity) best = { id, similarity }
        }
        if (best === null) continue
        if (best.similarity >= SPAN_SIMILARITY_THRESHOLD) {
          const previous = bestQuote.get(best.id)
          if (previous === undefined || span.length > previous.length) bestQuote.set(best.id, span)
          continue
        }
        invalid = true
        findings.push({
          gate: 'citations',
          kind: 'citation_span_mismatch',
          block_index: blockIndex,
          sentence: clip(segment.sentence),
          citation_ids: [...ids],
          detail: `quoted span is ${Math.round(best.similarity * 100)} % of the cited text, under ${Math.round(SPAN_SIMILARITY_THRESHOLD * 100)} %`,
        })
      }
      if (!invalid) return segment.text
      stripped = true
      for (const id of ids) struck.add(id)
      if (own) return removeCiteIds(segment.text, new Set(ids))
      // The sentence leaned on the block's sibling list: that list no longer vouches for it.
      sibling = sibling.filter((id) => !ids.includes(id))
      return segment.text
    })
    content = rebuilt.join('')

    // 3. What the block still rests on: the markers left inline, plus the sibling ids no
    //    struck sentence named — an id whose only support was a misquoting sentence goes.
    const inline = new Set(citeIdsIn(content))
    const remaining = unique([
      ...inline,
      ...sibling.filter((id) => inline.has(id) || !struck.has(id)),
    ])
    for (const id of remaining) used.add(id)
    const trimmed = content.trimEnd()
    if (remaining.length > 0 || !isSubstantive(block.type)) {
      return { ...block, content: trimmed === '' ? block.content : trimmed, citations: remaining }
    }
    retyped += 1
    return {
      ...block,
      type: 'general_knowledge',
      content: trimmed === '' ? block.content : trimmed,
      citations: [],
      misconception_id: null,
    }
  })

  const citations = input.citations
    .filter((citation) => used.has(citation.id))
    .map((citation) => {
      const quote = bestQuote.get(citation.id)
      return quote === undefined ? citation : { ...citation, quote }
    })

  const warnings = [
    ...(stripped
      ? [
          warning('citation_span_mismatch', {
            lesson: input.lessonSpecId,
            sentences: findings.length,
          }),
        ]
      : []),
    ...(retyped > 0
      ? [warning('lesson_block_uncited', { lesson: input.lessonSpecId, block: 'qa' })]
      : []),
  ]

  return {
    ...gateResult('citations', stripped ? 'fix' : 'pass', { findings, warnings }),
    blocks,
    citations,
    retyped,
  }
}
