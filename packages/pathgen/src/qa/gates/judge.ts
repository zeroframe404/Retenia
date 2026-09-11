import { JUDGE_CRITERIA, type JudgeCriterion, type PedagogyJudgeOutput } from '../../schemas/qa'
import { warning } from '../../schemas/warnings'
import type { QaFinding } from '../lesson-qa'
import { clip, type EditInstruction, type GateResult, gateResult } from './types'

/**
 * Gate (i) — §5 gate 9: *"Pedagogy judge: rubric 1–5 with anchors, a model different from
 * the generator, temperature 0"* — the code half of P7.
 *
 * Two things the code decides rather than the model. **The score** is the mean of the five
 * criteria, not the model's `overall`: the anchors are per criterion and a single number the
 * model chose is the taste the anchors exist to remove (`overall` is kept beside it). **The
 * bias guard** (§14 pitfall 16) holds at runtime, not only in settings: an answer that a
 * fallback produced on the generator's own model is discarded with a warning, and the gate is
 * `skipped` — a lesson unjudged is honest; a lesson judged by its author is not.
 */

export const JUDGE_REGENERATE = 3

export interface JudgeGateInput {
  readonly lessonSpecId: string
  readonly output: PedagogyJudgeOutput
  /** The model that answered, as `WaveAnswer.model` reports it. */
  readonly answeredBy: string
  /** `expansion.p3.model` — the model that wrote the lesson. */
  readonly generatorModel: string
  readonly blockCount: number
}

export interface JudgeGateResult extends GateResult {
  readonly pedagogyScore: number | null
  readonly overall: number | null
  readonly criteria: readonly { readonly id: JudgeCriterion; readonly score: number }[]
}

export function meanScore(criteria: readonly { readonly score: number }[]): number | null {
  if (criteria.length === 0) return null
  const sum = criteria.reduce((total, entry) => total + entry.score, 0)
  return Math.round((sum / criteria.length) * 100) / 100
}

export function applyJudge(input: JudgeGateInput): JudgeGateResult {
  if (input.answeredBy !== '' && input.answeredBy === input.generatorModel) {
    return {
      ...gateResult('judge', 'skipped', {
        warnings: [
          warning('judge_same_as_generator', {
            lesson: input.lessonSpecId,
            model: input.generatorModel,
          }),
        ],
      }),
      pedagogyScore: null,
      overall: null,
      criteria: [],
    }
  }

  // One score per criterion, the first when the model repeated one, in the rubric's order.
  const seen = new Map<JudgeCriterion, number>()
  for (const entry of input.output.criteria) {
    if (!seen.has(entry.id)) seen.set(entry.id, entry.score)
  }
  const criteria = JUDGE_CRITERIA.flatMap((id) => {
    const score = seen.get(id)
    return score === undefined ? [] : [{ id, score }]
  })
  const pedagogyScore = meanScore(criteria)

  const edits: EditInstruction[] = input.output.edits
    .filter((edit) => edit.block_index < input.blockCount)
    .map(
      (edit): EditInstruction => ({
        blockIndex: edit.block_index,
        kind: edit.kind,
        // The judge's wording is another model's answer over the learner's sources: P8 is
        // told to apply it, but reads it as data.
        instruction: "Apply the pedagogy reviewer's instruction given as `instruction`.",
        details: [{ label: 'instruction', text: clip(edit.instruction, 500) }],
        replacement: edit.replacement,
        source: 'judge',
      }),
    )
  const findings: QaFinding[] = edits.map((edit) => ({
    gate: 'judge',
    kind: 'judge_edit',
    block_index: edit.blockIndex,
    // Every edit above is built with exactly one detail, the judge's own instruction.
    sentence: clip((edit.details[0] as { readonly text: string }).text),
    citation_ids: [],
    detail: edit.kind,
  }))

  const regenerate = pedagogyScore !== null && pedagogyScore < JUDGE_REGENERATE
  return {
    ...gateResult('judge', regenerate ? 'regenerate' : edits.length > 0 ? 'fix' : 'pass', {
      findings,
      edits: regenerate ? [] : edits,
      warnings: regenerate
        ? [
            warning('lesson_below_threshold', {
              lesson: input.lessonSpecId,
              pedagogy: pedagogyScore as number,
            }),
          ]
        : [],
    }),
    pedagogyScore,
    overall: input.output.overall,
    criteria,
  }
}
