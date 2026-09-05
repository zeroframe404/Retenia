import type {
  AnswerEvidence,
  GradeMeta as CoreGradeMeta,
  GradeResult as CoreGradeResult,
  CriterionScore,
  Grade,
  RatingSignals,
  ReviewSpec,
} from '@retenia/core'
import { AI_GRADE_ENGINES, CONFIDENCE_LEVELS } from '@retenia/core'
import { z } from 'zod'
import type { Review } from './grading'
import { gradeLiteralSchema } from './responses'

/**
 * `GradeResult` of `docs/spec/03-activities.md` §7: `@retenia/core`'s minimal
 * `{ score, correct, meta }` — all `toRating` needs — plus the presentation half the host
 * shows: per-item verdicts, feedback and the resolved rating.
 *
 * `rating` is `null` as a grader returns it; `rateResult` (activity-graders) or the host fills
 * it through `toRating`, except for M-self types where the user's button is the rating.
 */

export interface PerItem {
  id: string
  correct: boolean
  expected?: string
  got?: string
}

/**
 * What an AI-graded `long_text` answer produced beyond its score
 * (`docs/spec/03-activities.md` §10's AI row, `docs/spec/04-path-generation.md` §12).
 *
 * It rides on the grade's `meta` rather than in `perItem` because `perItem` is a per-*item*
 * verdict (`correct`, `expected`, `got`) and a rubric criterion has none of those: it has a
 * partial score, a weight, an anchor and quotes from the learner's own answer. Keeping it here
 * means the whole rubric breakdown is persisted with the attempt (`attempts.feedback`) and
 * reaches the feedback panel through the same `GradeResult` every other family uses.
 */
export interface AiGradeDetail {
  perCriterion: readonly CriterionScore[]
  /** Quotes **from the answer** backing the scores (§12: "evidence cited from the answer"). */
  evidence: readonly AnswerEvidence[]
  /** §12's injection detection fired: the answer was graded on the rubric alone. */
  injectionSuspected?: boolean
  /** The provider's model id, when a model graded it. */
  model?: string
}

export interface GradeMeta extends CoreGradeMeta {
  /**
   * Which engine produced the score: a deterministic one (`keypoints`, `fuzzy`, `exact`,
   * `numeric`, `regex`), or one of `ai` / `fake` / `local` for the AI-graded families.
   */
  engine?: string
  /** Raw measurements a §10 row grades on beyond the score — today only ordering's pair count. */
  signals?: RatingSignals
  /** The rubric breakdown, when an AI grader (or its deterministic stand-in) produced it. */
  ai?: AiGradeDetail
}

export interface GradeResult extends CoreGradeResult {
  perItem?: PerItem[]
  feedback: string
  rating: Grade | null
  meta: GradeMeta
}

export const criterionScoreSchema = z.object({
  id: z.string().min(1),
  criterion: z.string().min(1),
  score: z.number().min(0).max(1),
  weight: z.number().positive(),
  level: z.string().min(1).optional(),
  comment: z.string().min(1).optional(),
})

export const answerEvidenceSchema = z.object({
  quote: z.string().min(1),
  criterionId: z.string().min(1).optional(),
})

export const aiGradeDetailSchema = z.object({
  perCriterion: z.array(criterionScoreSchema),
  evidence: z.array(answerEvidenceSchema),
  injectionSuspected: z.boolean().optional(),
  model: z.string().min(1).optional(),
})

export const ratingOverrideSchema = z.object({
  from: gradeLiteralSchema.nullable(),
  to: gradeLiteralSchema,
  reason: z.string().min(1).optional(),
  at: z.string().min(1).optional(),
})

export const gradeMetaSchema = z.object({
  timeMs: z.number().min(0),
  attempts: z.int().min(1),
  hintsUsed: z.int().min(0),
  confidence: z.enum(CONFIDENCE_LEVELS).optional(),
  engine: z.string().min(1).optional(),
  signals: z.object({ pairsOutOfOrder: z.int().min(0).optional() }).optional(),
  uncertain: z.boolean().optional(),
  ratingOverride: ratingOverrideSchema.optional(),
  ai: aiGradeDetailSchema.optional(),
})

/** The three engines the AI-graded families report (`@retenia/core`'s `AI_GRADE_ENGINES`). */
export const aiGradeEngineSchema = z.enum(AI_GRADE_ENGINES)

export const perItemSchema = z.object({
  id: z.string().min(1),
  correct: z.boolean(),
  expected: z.string().optional(),
  got: z.string().optional(),
})

/** The persisted shape (`attempts.feedback`) and the IPC shape of a grade. */
export const gradeResultSchema = z.object({
  score: z.number().min(0).max(1),
  correct: z.boolean(),
  perItem: z.array(perItemSchema).optional(),
  feedback: z.string(),
  rating: gradeLiteralSchema.nullable(),
  meta: gradeMetaSchema,
})

/** The activity's `review` block as the `ReviewSpec` `toRating` and `reviewActivity` take. */
export function toReviewSpec(activity: { review: Review }): ReviewSpec {
  const { eligible, ratingStrategy, expectedSeconds } = activity.review
  return {
    eligible,
    rule: ratingStrategy,
    ...(expectedSeconds === undefined ? {} : { expectedSeconds }),
  }
}
