import type { Activity, BloomLevel } from '@retenia/core'
import { MCQ_TYPES } from '@retenia/core'
import { LESSON_PRACTICE_LIMITS } from '../../expand/practice'
import { warning } from '../../schemas/warnings'
import type { QaFinding } from '../lesson-qa'
import { type GateResult, gateResult } from './types'

/**
 * Gate (f) — §5 gate 6: *"Variety and Bloom"*, over the rows stage 7 actually wrote.
 *
 * §4's constraints, re-checked on the persisted block rather than trusted from the
 * composer's own report: 4–8 activities, ≥ 3 distinct types, ≤ 40 % MCQ, ≥ 1 at the apply
 * level or above — and, across the module, ≥ 3 distinct Bloom levels, which no single
 * lesson can know about itself. The four lesson rules are stated here rather than reused from
 * `checkLessonPractice` because that checker reads an `ActivityOption`, whose only adapter
 * lives in a package this one may not import; the vocabulary (`MCQ_TYPES`, the apply floor)
 * is the same.
 *
 * Report-only: the fix for a thin practice block is P4, which P8 cannot do, so the outcome
 * says what "Más ejemplos" would repair. And "Más ejemplos" itself *appends* a block's worth
 * of variants each time (`expansion.variants`), so the count ceiling grows with the rounds
 * the lesson has had: the 4–8 is per block written, not per lesson forever.
 */

export const VARIETY_LIMITS = Object.freeze({
  min: LESSON_PRACTICE_LIMITS.min,
  max: LESSON_PRACTICE_LIMITS.max,
  minDistinctTypes: 3,
  maxMcqShare: 0.4,
  minModuleBloomLevels: 3,
})

const APPLY_OR_ABOVE: readonly BloomLevel[] = Object.freeze([
  'apply',
  'analyze',
  'evaluate',
  'create',
])

export interface VarietyGateInput {
  readonly lessonSpecId: string
  readonly activities: readonly Pick<Activity, 'type' | 'bloom'>[]
  /**
   * The whole module's activities, this lesson's included, when every core lesson of the
   * module has some — `null` until then, because a module still being written cannot fail
   * a variety rule it has not had the chance to meet.
   */
  readonly module: {
    readonly specId: string
    readonly activities: readonly Pick<Activity, 'bloom'>[]
  } | null
  /** How many "Más ejemplos" rounds appended to the block — each allowed another `max`. */
  readonly variantRounds?: number
}

export function checkVariety(input: VarietyGateInput): GateResult {
  const findings: QaFinding[] = []
  const rules: { rule: string; detail: string }[] = []
  const count = input.activities.length
  const limits = VARIETY_LIMITS
  const max = limits.max * (1 + Math.max(0, input.variantRounds ?? 0))

  if (count < limits.min || count > max) {
    rules.push({ rule: 'count', detail: `${count} activities, wanted ${limits.min}–${max}` })
  }
  const types = new Set(input.activities.map((activity) => activity.type))
  if (count > 0 && types.size < limits.minDistinctTypes) {
    rules.push({
      rule: 'distinct_types',
      detail: `${types.size} distinct types, wanted ${limits.minDistinctTypes}`,
    })
  }
  const mcq = input.activities.filter((activity) => MCQ_TYPES.includes(activity.type)).length
  if (count > 0 && mcq / count > limits.maxMcqShare) {
    rules.push({
      rule: 'mcq_share',
      detail: `${mcq}/${count} MCQ, over ${Math.round(limits.maxMcqShare * 100)} %`,
    })
  }
  if (
    count > 0 &&
    !input.activities.some(
      (activity) => activity.bloom !== null && APPLY_OR_ABOVE.includes(activity.bloom),
    )
  ) {
    rules.push({ rule: 'apply_bloom', detail: 'no activity at the apply level or above' })
  }

  for (const entry of rules) {
    findings.push({
      gate: 'variety',
      kind: 'variety_rule',
      block_index: null,
      sentence: entry.rule,
      citation_ids: [],
      detail: entry.detail,
    })
  }
  const warnings = rules.map((entry) =>
    warning('practice_incomplete', {
      lesson: input.lessonSpecId,
      rule: entry.rule,
      detail: entry.detail,
    }),
  )

  if (input.module !== null) {
    const levels = new Set(
      input.module.activities.flatMap((activity) =>
        activity.bloom === null ? [] : [activity.bloom],
      ),
    )
    if (levels.size < limits.minModuleBloomLevels) {
      findings.push({
        gate: 'variety',
        kind: 'module_bloom_variety',
        block_index: null,
        sentence: input.module.specId,
        citation_ids: [],
        detail: `${levels.size} Bloom levels across the module, wanted ${limits.minModuleBloomLevels}`,
      })
      warnings.push(
        warning('module_bloom_variety', {
          lesson: input.lessonSpecId,
          module: input.module.specId,
          levels: [...levels].sort(),
        }),
      )
    }
  }

  return gateResult('variety', findings.length === 0 ? 'pass' : 'fix', { findings, warnings })
}
