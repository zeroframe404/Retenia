import { isSubstantive, type LessonCitation, type TheoryBlock } from '../../schemas/lesson'
import type { EditLessonOutput } from '../../schemas/qa'
import { warning } from '../../schemas/warnings'
import { CITE_MARKER, citeIdsIn, segmentSentences } from '../claims'
import type { QaFinding } from '../lesson-qa'
import { clip, type EditInstruction, type GateResult, gateResult } from './types'

/**
 * Gate (j) — §5 gate 10 and §9's P8: *"applies only the edits without touching verified
 * citations"* — the code half, which is where the guarantee actually lives.
 *
 * P8 is asked politely, in its prompt, to leave every `[cite:…]` marker and every quoted span
 * alone. This gate does not rely on that. Every change it returns is admitted only if:
 *
 *   - an edit of the same kind named the same block, and that edit has not already been
 *     spent — a change nobody asked for is refused, and so is a second change for one edit,
 *     which is what keeps one `insert_after` from becoming a dozen insertions;
 *   - a `replace` keeps **exactly** the markers of the original — same ids, same
 *     multiplicity, **same order**, because a marker that moved ahead of another now sits on
 *     a different claim, and the same **grouping by sentence**, because two cited sentences
 *     merged into one put the first claim under the second's citation — and every stored
 *     `citation.quote` the original contained, verbatim;
 *   - a `delete` targets a block that carries no marker — deleting a cited block would drop a
 *     verified citation with it;
 *   - an `insert_after` adds text with no marker at all — new text cannot cite, because
 *     nothing has verified it against a source, so it enters as `general_knowledge` when it
 *     follows a substantive block.
 *
 * A change that fails keeps the original block, byte for byte, and is reported. The
 * acceptance test is a diff assertion: before and after this gate, the set of verified
 * citations is identical.
 *
 * What this gate cannot see is *meaning*: a rewritten sentence that keeps its marker may now
 * say something the source does not, and a block cited only through its sibling `citations`
 * list has no marker to hold still. That is why the pipeline sends every edited block back
 * through P6 before the verdict, and never persists an edited block P6 did not answer for.
 */

export interface EditGateInput {
  readonly lessonSpecId: string
  readonly blocks: readonly TheoryBlock[]
  readonly citations: readonly LessonCitation[]
  /** What P8 was asked for. */
  readonly edits: readonly EditInstruction[]
  readonly output: EditLessonOutput
}

export interface EditGateResult extends GateResult {
  readonly blocks: readonly TheoryBlock[]
  readonly applied: number
  readonly rejected: number
}

/** The markers of a text in reading order, with multiplicity. */
export function markerSequence(content: string): string[] {
  return [...content.matchAll(CITE_MARKER)].flatMap((match) =>
    (match[1] as string).split(/[,\s]+/).filter((id) => id !== ''),
  )
}

/** The same, sorted — two texts with equal lists cite the same things. */
export function markerList(content: string): string[] {
  return markerSequence(content).sort()
}

/** The markers of each cited sentence, in reading order — the shape a replacement must keep. */
export function markerGroups(content: string): string[][] {
  return segmentSentences(content)
    .map((segment) => markerSequence(segment.text))
    .filter((group) => group.length > 0)
}

function sameMarkers(a: string, b: string): boolean {
  const left = markerGroups(a)
  const right = markerGroups(b)
  return (
    left.length === right.length &&
    left.every(
      (group, index) =>
        group.length === right[index]?.length &&
        group.every((id, position) => id === right[index]?.[position]),
    )
  )
}

/** The stored quotes the block actually contains — what a replacement must keep. */
function quotesIn(content: string, citations: readonly LessonCitation[]): string[] {
  return citations.flatMap((citation) =>
    citation.quote !== null && content.includes(citation.quote) ? [citation.quote] : [],
  )
}

export function applyEdits(input: EditGateInput): EditGateResult {
  const findings: QaFinding[] = []
  const replaced = new Map<number, string>()
  const deleted = new Set<number>()
  const inserted = new Map<number, string[]>()
  let rejected = 0

  const refuse = (index: number, reason: string, content: string): void => {
    rejected += 1
    findings.push({
      gate: 'edit',
      kind: 'edit_rejected',
      block_index: index,
      sentence: clip(content),
      citation_ids: markerList(content),
      detail: reason,
    })
  }

  // Each edit admits one change: the budget per (block, kind) is how many were asked for.
  const budget = new Map<string, number>()
  for (const edit of input.edits) {
    const key = `${edit.blockIndex}:${edit.kind}`
    budget.set(key, (budget.get(key) ?? 0) + 1)
  }

  for (const change of input.output.changes) {
    const original = input.blocks[change.block_index]
    const key = `${change.block_index}:${change.kind}`
    const left = budget.get(key) ?? 0
    if (original === undefined || left === 0) {
      refuse(
        change.block_index,
        budget.has(key) ? 'more changes than edits asked for' : 'a change nobody asked for',
        change.content,
      )
      continue
    }
    budget.set(key, left - 1)
    const content = change.content.trim()
    switch (change.kind) {
      case 'replace': {
        if (content === '') {
          refuse(change.block_index, 'a replacement with no text', original.content)
          break
        }
        if (!sameMarkers(original.content, content)) {
          refuse(change.block_index, 'the replacement changed a citation marker', original.content)
          break
        }
        if (
          !quotesIn(original.content, input.citations).every((quote) => content.includes(quote))
        ) {
          refuse(
            change.block_index,
            'the replacement changed a verified quotation',
            original.content,
          )
          break
        }
        replaced.set(change.block_index, content)
        break
      }
      case 'delete': {
        if (markerSequence(original.content).length > 0) {
          refuse(change.block_index, 'deleting the block would drop a citation', original.content)
          break
        }
        deleted.add(change.block_index)
        break
      }
      case 'insert_after': {
        if (content === '') {
          refuse(change.block_index, 'an insertion with no text', '')
          break
        }
        if (citeIdsIn(content).length > 0) {
          refuse(change.block_index, 'inserted text may not cite', content)
          break
        }
        const list = inserted.get(change.block_index) ?? []
        list.push(content)
        inserted.set(change.block_index, list)
        break
      }
    }
  }

  const blocks: TheoryBlock[] = []
  for (const [index, block] of input.blocks.entries()) {
    if (!deleted.has(index)) {
      const content = replaced.get(index)
      blocks.push(content === undefined ? block : { ...block, content })
    }
    for (const content of inserted.get(index) ?? []) {
      blocks.push({
        type: isSubstantive(block.type) ? 'general_knowledge' : block.type,
        content,
        citations: [],
        diagram: null,
        misconception_id: null,
      })
    }
  }

  const applied = replaced.size + deleted.size + [...inserted.values()].flat().length
  return {
    ...gateResult('edit', applied > 0 ? 'fix' : rejected > 0 ? 'skipped' : 'pass', {
      findings,
      warnings:
        rejected === 0
          ? []
          : [warning('edit_rejected', { lesson: input.lessonSpecId, count: rejected })],
    }),
    blocks,
    applied,
    rejected,
  }
}
