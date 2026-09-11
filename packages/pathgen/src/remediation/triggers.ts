import type { ConfidenceLevel, RemediationError } from '@retenia/core'
import { type ReopenCard, type ReopenLog, shouldReopen } from '../diagnostic/verify'
import { REMEDIATION_POLICY, type RemediationPolicy } from './policy'
import type { ReinforcementAnswer, RemediationCandidate } from './types'

/**
 * The five triggers of `docs/spec/04-path-generation.md` §11, as pure evaluators: each takes
 * the evidence the service gathered and says whether it fires, on which concept, and why.
 * None reads a clock, a repository or a model — the fixtures in `triggers.test.ts` are the
 * whole of their behaviour.
 */

const round = (value: number): number => Math.round(value * 1000) / 1000

function errorOf(answer: ReinforcementAnswer): RemediationError | null {
  if (answer.correct || answer.stem === undefined || answer.stem === null) return null
  return {
    stem: answer.stem,
    chosen: answer.chosen ?? null,
    correct: answer.correctAnswer ?? null,
  }
}

/**
 * "module reinforcement < 70 % on a concept": one candidate per concept under the threshold,
 * worst first, so the one the limits let through is the one the learner struggled with most.
 */
export function reinforcementTriggers(
  input: {
    readonly pathVersionId: string
    readonly moduleId: string
    readonly answers: readonly ReinforcementAnswer[]
  },
  policy: Pick<RemediationPolicy, 'reinforcementThreshold'> = REMEDIATION_POLICY,
): RemediationCandidate[] {
  const byConcept = new Map<string, { answered: number; correct: number; order: number }>()
  const answersOf = new Map<string, ReinforcementAnswer[]>()
  for (const answer of input.answers) {
    for (const conceptId of new Set(answer.conceptIds)) {
      const tally = byConcept.get(conceptId) ?? { answered: 0, correct: 0, order: byConcept.size }
      tally.answered += 1
      if (answer.correct) tally.correct += 1
      byConcept.set(conceptId, tally)
      const list = answersOf.get(conceptId) ?? []
      list.push(answer)
      answersOf.set(conceptId, list)
    }
  }

  const low = [...byConcept.entries()]
    .map(([conceptId, tally]) => ({
      conceptId,
      ...tally,
      accuracy: tally.correct / tally.answered,
    }))
    .filter((entry) => entry.accuracy < policy.reinforcementThreshold)
    .sort((a, b) => a.accuracy - b.accuracy || a.order - b.order)

  return low.map((entry) => {
    const answers = answersOf.get(entry.conceptId) ?? []
    const misconceptions = answers
      .filter((answer) => !answer.correct && typeof answer.misconceptionId === 'string')
      .map((answer) => answer.misconceptionId as string)
    return {
      trigger: 'reinforcement_low',
      pathVersionId: input.pathVersionId,
      conceptId: entry.conceptId,
      misconceptionId: mostFrequent(misconceptions),
      lessonId: null,
      evidence: {
        module_id: input.moduleId,
        answered: entry.answered,
        correct: entry.correct,
        accuracy: round(entry.accuracy),
        threshold: policy.reinforcementThreshold,
      },
      errors: answers.map(errorOf).filter((error): error is RemediationError => error !== null),
    }
  })
}

function mostFrequent(values: readonly string[]): string | null {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best: string | null = null
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

/**
 * "≥ 2 lapses in 14 days or mean R < 0.7 on the concept's cards" — §10's deferred verification
 * rule, over one concept's cards instead of one module's. Lapses win when both hold: they are
 * the stronger, fresher evidence.
 */
export function memoryTrigger(input: {
  readonly pathVersionId: string
  readonly conceptId: string
  readonly now: Date
  readonly logs: readonly ReopenLog[]
  readonly cards: readonly ReopenCard[]
}): RemediationCandidate | null {
  const verdict = shouldReopen({ now: input.now, logs: input.logs, cards: input.cards })
  if (!verdict.reopen || verdict.reason === null) return null
  return {
    trigger: verdict.reason === 'lapses' ? 'memory_lapses' : 'memory_retention',
    pathVersionId: input.pathVersionId,
    conceptId: input.conceptId,
    misconceptionId: null,
    lessonId: null,
    evidence: {
      lapses: verdict.lapses,
      mean_r: verdict.meanR === null ? null : round(verdict.meanR),
      cards: input.cards.length,
      window_days: REMEDIATION_POLICY.lapseWindowDays,
    },
    errors: [],
  }
}

/**
 * "a confident error in the diagnostic or in an exam": wrong, and answered "sure". The first
 * concept the item measures is the one the detour is about — items name one concept, rarely two.
 */
export function confidentErrorTrigger(input: {
  readonly pathVersionId: string
  readonly context: 'diagnostic' | 'exam'
  readonly conceptIds: readonly string[]
  readonly misconceptionId: string | null
  readonly confidence: ConfidenceLevel | null
  readonly correct: boolean
  readonly itemId?: string | null
  readonly moduleId?: string | null
  readonly sessionId?: string | null
  readonly error?: RemediationError | null
}): RemediationCandidate | null {
  const conceptId = input.conceptIds[0]
  if (conceptId === undefined || input.correct || input.confidence !== 'sure') return null
  return {
    trigger: 'confident_error',
    pathVersionId: input.pathVersionId,
    conceptId,
    misconceptionId: input.misconceptionId,
    lessonId: null,
    evidence: {
      context: input.context,
      item_id: input.itemId ?? null,
      module_id: input.moduleId ?? null,
      session_id: input.sessionId ?? null,
      concept_ids: [...input.conceptIds],
    },
    errors: input.error === undefined || input.error === null ? [] : [input.error],
  }
}

/** "the same `misconception_id` failed twice" — `failures` counts this one. */
export function misconceptionTrigger(
  input: {
    readonly pathVersionId: string
    readonly conceptId: string
    readonly misconceptionId: string
    readonly failures: number
    readonly lessonId?: string | null
    readonly activityId?: string | null
  },
  policy: Pick<
    RemediationPolicy,
    'misconceptionRepeats' | 'misconceptionWindowDays'
  > = REMEDIATION_POLICY,
): RemediationCandidate | null {
  if (input.failures < policy.misconceptionRepeats) return null
  return {
    trigger: 'repeated_misconception',
    pathVersionId: input.pathVersionId,
    conceptId: input.conceptId,
    misconceptionId: input.misconceptionId,
    lessonId: input.lessonId ?? null,
    evidence: {
      failures: input.failures,
      activity_id: input.activityId ?? null,
      window_days: policy.misconceptionWindowDays,
    },
    errors: [],
  }
}

/** "the user asks 'I don't understand this'": always a candidate; the limits still apply. */
export function userRequestTrigger(input: {
  readonly pathVersionId: string
  readonly lessonId: string
  readonly conceptId: string
}): RemediationCandidate {
  return {
    trigger: 'user_request',
    pathVersionId: input.pathVersionId,
    conceptId: input.conceptId,
    misconceptionId: null,
    lessonId: input.lessonId,
    evidence: { lesson_id: input.lessonId },
    errors: [],
  }
}
