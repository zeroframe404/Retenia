import type { Remediation } from '@retenia/core'
import {
  INSERTED_STATUSES,
  REMEDIATION_POLICY,
  type RemediationPolicy,
  WEEKLY_COUNTED_STATUSES,
} from './policy'
import type { LimitVerdict } from './types'

/**
 * §11 "Limits": 1 active remediation per module and 3 per week; dedupe by `concept_id`; at the
 * third remediation of a concept, send the learner back to the core lesson instead.
 *
 * Pure over the log. The order is the order of what the learner would want to be told:
 * "you already have this detour" before "go back to the lesson" before "one at a time here"
 * before "that's enough for this week".
 */

export type LimitRow = Pick<Remediation, 'conceptId' | 'moduleId' | 'status' | 'createdAt'>

export interface LimitsInput {
  readonly conceptId: string
  /** The module the detour would sit in (its anchor's). */
  readonly moduleId: string
  /** Every remediation of this path version. */
  readonly version: readonly LimitRow[]
  /** Every remediation created in the last week, whichever path it belongs to: the week is the
   *  learner's, not the path's. */
  readonly recent: readonly Pick<Remediation, 'status' | 'createdAt'>[]
  readonly now: Date
  /** For `revisit_core`. */
  readonly teachingLessonId?: string | null
}

export function checkLimits(
  input: LimitsInput,
  policy: Pick<
    RemediationPolicy,
    'maxActivePerModule' | 'maxPerWeek' | 'weekMs' | 'revisitCoreAt'
  > = REMEDIATION_POLICY,
): LimitVerdict {
  const sameConcept = input.version.filter((row) => row.conceptId === input.conceptId)
  if (sameConcept.some((row) => row.status === 'active')) {
    return { kind: 'refuse', refusal: 'duplicate_concept' }
  }
  const insertedForConcept = sameConcept.filter((row) => INSERTED_STATUSES.has(row.status)).length
  if (insertedForConcept >= policy.revisitCoreAt - 1) {
    return {
      kind: 'refuse',
      refusal: 'revisit_core',
      revisitLessonId: input.teachingLessonId ?? null,
    }
  }
  const activeInModule = input.version.filter(
    (row) => row.moduleId === input.moduleId && row.status === 'active',
  ).length
  if (activeInModule >= policy.maxActivePerModule) {
    return { kind: 'refuse', refusal: 'module_active' }
  }
  const since = input.now.getTime() - policy.weekMs
  const thisWeek = input.recent.filter(
    (row) => WEEKLY_COUNTED_STATUSES.has(row.status) && row.createdAt.getTime() > since,
  ).length
  if (thisWeek >= policy.maxPerWeek) {
    return { kind: 'refuse', refusal: 'weekly_limit' }
  }
  return { kind: 'insert' }
}
