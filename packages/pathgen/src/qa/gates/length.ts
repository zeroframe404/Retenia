import { countWords } from '@retenia/core'
import { isSubstantive, type TheoryBlock } from '../../schemas/lesson'
import { warning } from '../../schemas/warnings'
import { stripMarkers } from '../claims'
import type { QaMode } from '../lesson-qa'
import { type EditInstruction, type GateResult, gateResult } from './types'

/**
 * Gate (g) — §5 gate 7: *"Length: within the lesson budget"* — §4's 600–1,200 words of
 * theory, counted by the same rule the renderer's counter uses and never trusted from P3's
 * own `word_count`. The activity count is gate (f)'s.
 *
 * Too long is an edit P8 can make (shorten the longest substantive block). Too short is not:
 * the fidelity contract forbids P8 from adding claims, so a thin lesson is reported and left
 * to "Regenerar".
 */

export const THEORY_WORDS = Object.freeze({ min: 600, max: 1_200 })

export function theoryWordCount(blocks: readonly TheoryBlock[]): number {
  return blocks.reduce((sum, block) => sum + countWords(stripMarkers(block.content)), 0)
}

export interface LengthGateInput {
  readonly lessonSpecId: string
  readonly blocks: readonly TheoryBlock[]
  readonly mode: QaMode
}

export function checkLength(input: LengthGateInput): GateResult {
  const words = theoryWordCount(input.blocks)
  if (words >= THEORY_WORDS.min && words <= THEORY_WORDS.max) return gateResult('length', 'pass')

  const over = words > THEORY_WORDS.max
  const edits: EditInstruction[] = []
  if (over && input.mode === 'full') {
    let longest = -1
    let longestWords = 0
    for (const [index, block] of input.blocks.entries()) {
      if (!isSubstantive(block.type)) continue
      const count = countWords(stripMarkers(block.content))
      if (count > longestWords) {
        longest = index
        longestWords = count
      }
    }
    if (longest >= 0) {
      edits.push({
        blockIndex: longest,
        kind: 'replace',
        instruction: `The lesson has ${words} words and the maximum is ${THEORY_WORDS.max}: shorten this block by about ${Math.min(longestWords, words - THEORY_WORDS.max)} words without dropping a claim that carries a citation.`,
        details: [],
        replacement: null,
        source: 'length',
      })
    }
  }

  return gateResult('length', 'fix', {
    edits,
    findings: [
      {
        gate: 'length',
        kind: 'theory_length',
        block_index: null,
        sentence: `${words} words`,
        citation_ids: [],
        detail: over
          ? `over the ${THEORY_WORDS.max}-word maximum`
          : `under the ${THEORY_WORDS.min}-word minimum`,
      },
    ],
    warnings: [
      warning('theory_length', {
        lesson: input.lessonSpecId,
        words,
        min: THEORY_WORDS.min,
        max: THEORY_WORDS.max,
      }),
    ],
  })
}
