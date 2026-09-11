import { type LessonTheory, lessonTheorySchema } from '../../schemas/lesson'
import { warning } from '../../schemas/warnings'
import { type GateResult, gateResult } from './types'

/**
 * Gate (a) — §5 gate 1: "Schema. Must validate."
 *
 * Already true at write time (`persistTheory` stores what `writeLessonOutputSchema` parsed
 * and `resolveCitations` kept), so this is a re-read of the stored column rather than a
 * second validation of the model's answer: the one way it fails is a row whose `theory`
 * was written by something other than stage 7, and the honest answer to that is a
 * regeneration, not a QA verdict over bytes the gates cannot read.
 */
export interface SchemaGateResult extends GateResult {
  readonly theory: LessonTheory | null
}

export function checkSchema(theory: unknown, lessonSpecId: string): SchemaGateResult {
  const parsed = lessonTheorySchema.safeParse(theory)
  if (parsed.success) return { ...gateResult('schema', 'pass'), theory: parsed.data }
  return {
    ...gateResult('schema', 'regenerate', {
      warnings: [
        warning('qa_failed', {
          lesson: lessonSpecId,
          gate: 'schema',
          error: parsed.error.issues
            .map((issue) => issue.message)
            .join('; ')
            .slice(0, 200),
        }),
      ],
    }),
    theory: null,
  }
}
