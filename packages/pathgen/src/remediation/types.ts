import type {
  ConfidenceLevel,
  JsonObject,
  RemediationError,
  RemediationRefusal,
  RemediationTrigger,
} from '@retenia/core'

/**
 * The domain events the remediation service is fed (`docs/spec/04-path-generation.md` §11
 * "Triggers"), as the service reads them. Each comes from somewhere that already knows the
 * fact: the reinforcement node's grader (9.3), the memory service's `card.reviewed`, the
 * diagnostic's result and the exam's grading, the lesson player's answers and its "no lo
 * entiendo" button.
 */

/** One graded answer of a module reinforcement. */
export interface ReinforcementAnswer {
  readonly conceptIds: readonly string[]
  readonly correct: boolean
  /** The question and the answers, when known — the errors P11 writes against. */
  readonly stem?: string | null
  readonly chosen?: string | null
  readonly correctAnswer?: string | null
  readonly misconceptionId?: string | null
}

export type RemediationSignal =
  | {
      readonly kind: 'reinforcement_completed'
      readonly pathVersionId: string
      readonly moduleId: string
      readonly answers: readonly ReinforcementAnswer[]
    }
  | {
      readonly kind: 'card_reviewed'
      readonly cardId: string
      readonly rating: number
      readonly at: Date
    }
  | {
      readonly kind: 'confident_error'
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
    }
  | {
      readonly kind: 'misconception_failed'
      readonly pathVersionId: string
      readonly conceptId: string
      readonly misconceptionId: string
      /** The attempt that failed, so it is never counted twice once its row is written. */
      readonly attemptId?: string | null
      readonly activityId?: string | null
      readonly lessonId?: string | null
      readonly at: Date
    }
  | {
      readonly kind: 'not_understood'
      readonly lessonId: string
      readonly conceptId?: string | null
    }

/** What a trigger evaluator proposes: a detour on one concept, with the evidence that fired it. */
export interface RemediationCandidate {
  readonly trigger: RemediationTrigger
  readonly pathVersionId: string
  readonly conceptId: string
  readonly misconceptionId: string | null
  /** The lesson the learner is on, when the signal names one ("no lo entiendo"). */
  readonly lessonId: string | null
  readonly evidence: JsonObject
  readonly errors: readonly RemediationError[]
}

export type LimitVerdict =
  | { readonly kind: 'insert' }
  | {
      readonly kind: 'refuse'
      readonly refusal: RemediationRefusal
      /** For `revisit_core`: the core lesson that teaches the concept. */
      readonly revisitLessonId?: string | null
    }

/** Where a detour goes on the path map. It never renumbers: it hangs off `anchor`. */
export interface Placement {
  readonly anchorLessonId: string
  readonly anchorSpecId: string
  readonly moduleId: string
  /** Shown right after the anchor, or right before it when the anchor depends on the concept. */
  readonly position: 'after' | 'before'
  /** The core lesson that teaches the concept, when one does. */
  readonly teachingLessonId: string | null
}
