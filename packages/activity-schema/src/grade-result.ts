import type {
  GradeMeta as CoreGradeMeta,
  GradeResult as CoreGradeResult,
  Grade,
  RatingSignals,
  ReviewSpec,
} from '@retenia/core'
import { CONFIDENCE_LEVELS } from '@retenia/core'
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

export interface GradeMeta extends CoreGradeMeta {
  /** Which engine produced the score: `keypoints`, `fuzzy`, an AI model id… */
  engine?: string
  /** Raw measurements a §10 row grades on beyond the score — today only ordering's pair count. */
  signals?: RatingSignals
}

export interface GradeResult extends CoreGradeResult {
  perItem?: PerItem[]
  feedback: string
  rating: Grade | null
  meta: GradeMeta
}

export const gradeMetaSchema = z.object({
  timeMs: z.number().min(0),
  attempts: z.int().min(1),
  hintsUsed: z.int().min(0),
  confidence: z.enum(CONFIDENCE_LEVELS).optional(),
  engine: z.string().min(1).optional(),
  signals: z.object({ pairsOutOfOrder: z.int().min(0).optional() }).optional(),
})

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
