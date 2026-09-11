import { isSubstantive, type TheoryBlock } from '../../schemas/lesson'
import type { FaithfulnessOutput } from '../../schemas/qa'
import { type GenerationWarning, warning } from '../../schemas/warnings'
import { type Claim, citeIdsIn, stripSegmentMarkers } from '../claims'
import type { QaFinding, QaMode } from '../lesson-qa'
import { clip, type EditInstruction, type GateResult, gateResult } from './types'

/**
 * Gate (c) — §5 gate 3: *"Faithfulness per claims: ≥ 0.9 passes; 0.7–0.9 → critic-editor;
 * < 0.7 → regenerate"* — the code half. P6 answers a verdict per claim; this turns the
 * answers into the lesson's score, the findings, the edits P8 will be asked for, and one
 * change to the text.
 *
 * **The change.** A claim P6 could not place in its cited fragment has a citation that does
 * not support it, and the reader must not be told otherwise: the markers of that sentence
 * are removed, exactly as gate 2 removes a citation whose quotation is not in the source,
 * and a substantive block left with none is retyped `general_knowledge`. It is done here, in
 * code, rather than asked of P8, so that P8's invariant — every marker it is handed survives
 * — stays simple and checkable. The sentence itself is not deleted: what to do with it is
 * P8's edit (reword it to what the fragment says, or drop it), and in light mode it is the
 * user's, with the finding pointing at it.
 *
 * **Contradiction across sources** (§7: *"contradictions between sources are detected in the
 * claims QA and are shown"*): a claim P6 marks `sources_differ` keeps its citations — both
 * sources are right about what they say — and gets a finding carrying both ids, which the
 * report renders as "las fuentes difieren" with one link per source.
 *
 * **A claim P6 did not answer** counts against the score — §5's ratio is "supported ÷ total",
 * and a claim nobody verified is not supported — but its markers stay and no edit is asked
 * for it, because nothing says it is wrong. An answer that names none of the claims is not
 * a verdict at all: the gate is `skipped` with `qa_failed`, and the caller treats the lesson
 * as unreviewed rather than scoring it zero and rewriting it over a verifier's glitch.
 */

export const FAITHFULNESS_PASS = 0.9
export const FAITHFULNESS_REGENERATE = 0.7

export interface FaithfulnessGateInput {
  readonly lessonSpecId: string
  readonly blocks: readonly TheoryBlock[]
  readonly claims: readonly Claim[]
  readonly output: FaithfulnessOutput
  readonly mode: QaMode
}

export interface FaithfulnessGateResult extends GateResult {
  readonly blocks: readonly TheoryBlock[]
  /** supported ÷ claims sent, or `null` when there were none or P6 answered none of them. */
  readonly faithfulness: number | null
  readonly supported: number
  /** The claims the score is over: every claim sent, once P6 answered at least one. */
  readonly evaluated: number
  /** How many of them P6 actually returned a verdict for. */
  readonly answered: number
}

function outcomeOf(score: number | null, mode: QaMode): GateResult['outcome'] {
  if (score === null) return 'skipped'
  if (score >= FAITHFULNESS_PASS) return 'pass'
  if (score >= FAITHFULNESS_REGENERATE) return mode === 'full' ? 'fix' : 'pass'
  return 'regenerate'
}

interface Struck {
  /** Segment indexes whose own markers go. */
  readonly ownSegments: Set<number>
  /** Ids those own markers named. */
  readonly ownIds: Set<string>
  /** Sibling ids a struck marker-less sentence leaned on. */
  readonly leanedStruck: Set<string>
  /** Sibling ids a supported marker-less sentence leaned on — still vouched for. */
  readonly leanedSupported: Set<string>
}

export function applyFaithfulness(input: FaithfulnessGateInput): FaithfulnessGateResult {
  const verdicts = new Map(input.output.claims.map((entry) => [entry.id, entry]))
  const findings: QaFinding[] = []
  const edits: EditInstruction[] = []
  const warnings: GenerationWarning[] = []
  const struck = new Map<number, Struck>()
  const struckOf = (blockIndex: number): Struck => {
    const existing = struck.get(blockIndex)
    if (existing !== undefined) return existing
    const fresh: Struck = {
      ownSegments: new Set(),
      ownIds: new Set(),
      leanedStruck: new Set(),
      leanedSupported: new Set(),
    }
    struck.set(blockIndex, fresh)
    return fresh
  }
  let supported = 0
  const answered = input.claims.filter((claim) => verdicts.has(claim.id)).length
  const evaluated = answered === 0 ? 0 : input.claims.length

  for (const claim of input.claims) {
    if (answered === 0) break
    const verdict = verdicts.get(claim.id)
    if (verdict === undefined) {
      findings.push({
        gate: 'faithfulness',
        kind: 'claim_unsupported',
        block_index: claim.blockIndex,
        sentence: clip(claim.sentence),
        citation_ids: [...claim.citationIds],
        detail: 'the verifier returned no verdict for this claim',
      })
      continue
    }
    if (verdict.sources_differ && verdict.differing_citation_ids.length > 1) {
      findings.push({
        gate: 'faithfulness',
        kind: 'sources_differ',
        block_index: claim.blockIndex,
        sentence: clip(claim.sentence),
        citation_ids: [...verdict.differing_citation_ids],
        detail: clip(verdict.note),
      })
      warnings.push(
        warning('sources_differ', {
          lesson: input.lessonSpecId,
          citations: [...verdict.differing_citation_ids],
        }),
      )
    }
    if (verdict.verdict === 'supported') {
      supported += 1
      if (!claim.ownCitations) {
        for (const id of claim.citationIds) struckOf(claim.blockIndex).leanedSupported.add(id)
      }
      continue
    }
    findings.push({
      gate: 'faithfulness',
      kind: verdict.verdict === 'contradicts' ? 'claim_contradicts' : 'claim_unsupported',
      block_index: claim.blockIndex,
      sentence: clip(claim.sentence),
      citation_ids: [...claim.citationIds],
      detail: clip(verdict.note),
    })
    const marks = struckOf(claim.blockIndex)
    if (claim.ownCitations) {
      marks.ownSegments.add(claim.segmentIndex)
      for (const id of claim.citationIds) marks.ownIds.add(id)
    } else {
      for (const id of claim.citationIds) marks.leanedStruck.add(id)
    }
    edits.push({
      blockIndex: claim.blockIndex,
      kind: 'replace',
      instruction:
        verdict.verdict === 'contradicts'
          ? 'The sentence given as `sentence` contradicts the cited source (the verifier says why under `note`): correct it to what the source says.'
          : 'The sentence given as `sentence` is not supported by the cited source (the verifier says why under `note`): reword it to what the source says, or remove it.',
      details: [
        { label: 'sentence', text: clip(claim.sentence, 160) },
        { label: 'note', text: clip(verdict.note, 120) },
      ],
      replacement: null,
      source: 'faithfulness',
    })
  }

  const blocks = input.blocks.map((block, index): TheoryBlock => {
    const marks = struck.get(index)
    if (marks === undefined) return block
    let content = block.content
    // Highest first, so an index computed over the original segments still names the same
    // sentence after an earlier one was rewritten — stripping never changes the count.
    for (const segmentIndex of [...marks.ownSegments].sort((a, b) => b - a)) {
      content = stripSegmentMarkers(content, segmentIndex)
    }
    // A sibling id survives while some marker still names it inline, or while it was never
    // the support of a struck sentence — either an own marker that went, or a marker-less
    // sentence it vouched for that no supported sentence also leaned on.
    const inline = new Set(citeIdsIn(content))
    const sibling = block.citations.filter(
      (id) =>
        inline.has(id) ||
        (!marks.ownIds.has(id) && !(marks.leanedStruck.has(id) && !marks.leanedSupported.has(id))),
    )
    const remaining = [...new Set([...inline, ...sibling])]
    // Never empty: a struck sentence had at least `MIN_CLAIM_CHARS` of text beside its marker.
    const trimmed = content.trimEnd()
    if (remaining.length > 0 || !isSubstantive(block.type)) {
      return { ...block, content: trimmed, citations: remaining }
    }
    warnings.push(warning('lesson_block_uncited', { lesson: input.lessonSpecId, block: 'qa' }))
    return {
      ...block,
      type: 'general_knowledge',
      content: trimmed,
      citations: [],
      misconception_id: null,
    }
  })

  const faithfulness = evaluated === 0 ? null : supported / evaluated
  const outcome = outcomeOf(faithfulness, input.mode)
  if (answered === 0 && input.claims.length > 0) {
    warnings.push(
      warning('qa_failed', {
        lesson: input.lessonSpecId,
        gate: 'P6_faithfulness',
        error: 'the verifier answered none of the claims',
      }),
    )
  }
  if (faithfulness !== null && faithfulness < FAITHFULNESS_PASS) {
    warnings.push(
      warning(outcome === 'regenerate' ? 'lesson_below_threshold' : 'faithfulness_needs_review', {
        lesson: input.lessonSpecId,
        faithfulness: Math.round(faithfulness * 100) / 100,
        supported,
        evaluated,
      }),
    )
  }

  return {
    ...gateResult('faithfulness', outcome, {
      findings,
      // Edits are only worth listing when P8 will run: in light mode the band is flagged.
      edits: input.mode === 'full' && outcome === 'fix' ? edits : [],
      warnings,
    }),
    blocks,
    faithfulness,
    supported,
    evaluated,
    answered,
  }
}
