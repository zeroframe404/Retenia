import type { EditKind } from '../../schemas/qa'
import type { GenerationWarning } from '../../schemas/warnings'
import type { QaFinding, QaGate, QaGateOutcome } from '../lesson-qa'

/**
 * What every gate answers, in the sub-phase prompt's words: `{ pass | fix | regenerate,
 * findings[] }` — plus the edits a `fix` asks P8 for, and the warnings the run collects.
 *
 * `skipped` is the fourth outcome, for a gate that could not run (no cited claims to check,
 * no language detector wired, no judge configured). It is reported rather than folded into
 * `pass`, because "this lesson passed" and "nobody looked" are different facts and the badge
 * shows one of them.
 */

export type EditSource = 'judge' | 'faithfulness' | 'length' | 'language' | 'glossary'

/** A piece of untrusted material an edit's directive refers to, by the label it is shown under. */
export interface EditDetail {
  readonly label: string
  readonly text: string
}

/**
 * One edit P8 is asked for. `instruction` is the only part the model is told to *obey*, so it
 * is minted by the gate from a fixed template and never carries text that came out of a
 * source, a lesson or another model's answer; whatever the directive is about — the sentence
 * it concerns, the verifier's note, a glossary term, the judge's own wording — travels in
 * `details`, and `tasks.ts` shows every detail inside a `<user_content>` envelope.
 */
export interface EditInstruction {
  readonly blockIndex: number
  readonly kind: EditKind
  readonly instruction: string
  readonly details: readonly EditDetail[]
  readonly replacement: string | null
  readonly source: EditSource
}

export interface GateResult {
  readonly gate: QaGate
  readonly outcome: QaGateOutcome
  readonly findings: readonly QaFinding[]
  readonly edits: readonly EditInstruction[]
  readonly warnings: readonly GenerationWarning[]
}

export function gateResult(
  gate: QaGate,
  outcome: QaGateOutcome,
  parts: Partial<Pick<GateResult, 'findings' | 'edits' | 'warnings'>> = {},
): GateResult {
  return {
    gate,
    outcome,
    findings: parts.findings ?? [],
    edits: parts.edits ?? [],
    warnings: parts.warnings ?? [],
  }
}

/** A finding's sentence and detail are bounded columns; cut them rather than fail the parse. */
export function clip(text: string, max = 300): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`
}
