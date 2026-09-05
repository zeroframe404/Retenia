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
import { LABEL_MAX, PLAIN_TEXT_MAX } from './common'
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

/**
 * Length ceilings on the strings a grade carries.
 *
 * A `GradeResult` is not trusted input either: for the AI-graded families its `feedback`,
 * `comment`, `level` and `evidence[].quote` are written by a model that has just been shown the
 * learner's answer (`docs/spec/04-path-generation.md` §12's injection surface), and the whole
 * object is persisted to `attempts.feedback` and rendered in the feedback panel through the same
 * Markdown/KaTeX pipeline as an activity's prompt. `./common` explains why that pipeline needs
 * a bound; these are the same numbers, sized for what P10 actually asks the model to write:
 * "two or three lines" of feedback and "one short line" per criterion.
 */

/** The learner-facing paragraph: ≈650 words, two orders of magnitude above "two or three lines". */
export const FEEDBACK_MAX = 4_000
/** One line about one criterion, or the reason on a manual rating override. */
export const GRADE_LINE_MAX = 1_000
/** A rubric has criteria, not chapters; a grade quotes a few passages, not the whole answer. */
export const CRITERIA_MAX = 50
/** One verdict per option, gap, token or pair — more than any MVP activity has items. */
export const PER_ITEM_MAX = 500

export const criterionScoreSchema = z.object({
  id: z.string().min(1).max(LABEL_MAX),
  criterion: z.string().min(1).max(GRADE_LINE_MAX),
  score: z.number().min(0).max(1),
  weight: z.number().positive(),
  level: z.string().min(1).max(GRADE_LINE_MAX).optional(),
  comment: z.string().min(1).max(GRADE_LINE_MAX).optional(),
})

export const answerEvidenceSchema = z.object({
  quote: z.string().min(1).max(PLAIN_TEXT_MAX),
  criterionId: z.string().min(1).max(LABEL_MAX).optional(),
})

export const aiGradeDetailSchema = z.object({
  perCriterion: z.array(criterionScoreSchema).max(CRITERIA_MAX),
  evidence: z.array(answerEvidenceSchema).max(CRITERIA_MAX),
  injectionSuspected: z.boolean().optional(),
  model: z.string().min(1).max(LABEL_MAX).optional(),
})

export const ratingOverrideSchema = z.object({
  from: gradeLiteralSchema.nullable(),
  to: gradeLiteralSchema,
  reason: z.string().min(1).max(GRADE_LINE_MAX).optional(),
  at: z.string().min(1).max(LABEL_MAX).optional(),
})

export const gradeMetaSchema = z.object({
  timeMs: z.number().min(0),
  attempts: z.int().min(1),
  hintsUsed: z.int().min(0),
  confidence: z.enum(CONFIDENCE_LEVELS).optional(),
  engine: z.string().min(1).max(LABEL_MAX).optional(),
  signals: z.object({ pairsOutOfOrder: z.int().min(0).optional() }).optional(),
  uncertain: z.boolean().optional(),
  ratingOverride: ratingOverrideSchema.optional(),
  ai: aiGradeDetailSchema.optional(),
})

/** The three engines the AI-graded families report (`@retenia/core`'s `AI_GRADE_ENGINES`). */
export const aiGradeEngineSchema = z.enum(AI_GRADE_ENGINES)

export const perItemSchema = z.object({
  id: z.string().min(1).max(LABEL_MAX),
  correct: z.boolean(),
  expected: z.string().max(PLAIN_TEXT_MAX).optional(),
  got: z.string().max(PLAIN_TEXT_MAX).optional(),
})

/** The persisted shape (`attempts.feedback`) and the IPC shape of a grade. */
export const gradeResultSchema = z.object({
  score: z.number().min(0).max(1),
  correct: z.boolean(),
  perItem: z.array(perItemSchema).max(PER_ITEM_MAX).optional(),
  feedback: z.string().max(FEEDBACK_MAX),
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
