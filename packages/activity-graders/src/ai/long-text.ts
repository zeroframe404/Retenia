import type { Activity, GradeResult } from '@retenia/activity-schema'
import { longTextResponseSchema, toReviewSpec } from '@retenia/activity-schema'
import type {
  AbortSignalLike,
  AiGradeResult,
  AiGrader,
  PersonalPace,
  ReviewContext,
} from '@retenia/core'
import { clampForContext } from '@retenia/core'
import { PASS_SCORE } from '../constants'
import type { AttemptMeta } from '../families/shared'
import { keyPointCoverage } from './coverage'
import { aiGradeInputFor } from './input'
import { preGradeLongText } from './pre-grade'

/**
 * The AI-graded half of the `long_text` family: `free_recall` and `essay_rubric`
 * (`docs/spec/03-activities.md` §6's MVP table, §10's **AI** row).
 *
 * `gradeLongText` — the deterministic key-point matcher — stays what `list_recall` and the
 * fixtures are graded by. This is the other path: an `AiGrader` port scores the answer against
 * the rubric, and its verdict becomes the `GradeResult` the host, the review log and the
 * feedback panel all speak.
 *
 * The rating is **not** run through `toRating`. §3's M-ai row says the rubric returns the
 * rating; re-deriving it from the score would only reproduce the band table, and would silently
 * overwrite the `null` an `uncertain` grade reports — the one thing §12 of
 * `docs/spec/04-path-generation.md` insists must reach the scheduler intact. The situational
 * clamp of §9 (no Easy in an exam) still applies, because that is a property of the exam and not
 * of how the rating was arrived at.
 */

export interface LongTextAiGradeOptions {
  /** Needed only for §9's exam clamp, which demotes a slow exam answer to Hard. */
  personalPace?: PersonalPace
  /**
   * Which context the answer is being logged under. `exam_sim` applies §9's mock-exam rule —
   * no Easy, and slow is Hard.
   *
   * It is an option rather than a field of the activity because it is not a property of the
   * activity: the same `essay_rubric` is a lesson question on Tuesday and a mock-exam question
   * on Friday, and only the session serving it knows which.
   */
  context?: ReviewContext
}

const NO_PACE: PersonalPace = { medianMs: null }

/**
 * `AiGradeResult` + the attempt's measurements → the `GradeResult` everything downstream takes.
 *
 * `perItem` stays what it is for every other `long_text` grade — one entry per **key point**,
 * covered or not — so a renderer can tick the expected points off the same way whether the score
 * came from the matcher, from a rubric or from the offline estimate. The rubric's own breakdown
 * is a different shape (a partial score, a weight, an anchor) and rides on `meta.ai`.
 */
export function aiGradeToGradeResult(
  ai: AiGradeResult,
  activity: Activity<'long_text'>,
  answer: string,
  meta: AttemptMeta,
  options: LongTextAiGradeOptions = {},
): GradeResult {
  const coverage = keyPointCoverage(answer, activity.payload.keyPoints)
  const correct = ai.score >= PASS_SCORE
  const review = toReviewSpec(activity)
  const rating =
    ai.rating === null
      ? null
      : clampForContext(
          ai.rating,
          options.context === undefined ? review : { ...review, context: options.context },
          { score: ai.score, correct, meta },
          options.personalPace ?? NO_PACE,
        )

  return {
    score: ai.score,
    correct,
    perItem: (activity.payload.keyPoints ?? []).map((point) => ({
      id: point.id,
      correct: coverage.covered.includes(point.id),
      expected: point.text,
    })),
    feedback: ai.feedback,
    rating,
    meta: {
      ...meta,
      engine: ai.engine,
      ...(ai.uncertain ? { uncertain: true } : {}),
      ai: {
        perCriterion: ai.perCriterion,
        evidence: ai.evidence,
        ...(ai.injectionSuspected ? { injectionSuspected: true } : {}),
        ...(ai.model === undefined ? {} : { model: ai.model }),
      },
    },
  }
}

/**
 * A grader for the two AI-graded `long_text` types, over any `AiGrader` — the real rubric
 * grader of `@retenia/activity-ai`, or `createFakeAiGrader()` offline and in tests. Shaped like
 * `<ActivityHost/>`'s `grade` port, which is why it takes the family *response* rather than the
 * raw string.
 *
 * It lives here rather than in the React host because none of it is React: the host takes it as
 * a port and stays ignorant of rubrics.
 *
 * It short-circuits on the local pre-grade first, so `docs/spec/01-decisions.md` §6's budget is
 * protected by the *adapter* and not merely by the goodwill of whatever grader is plugged in.
 */
export function createLongTextAiGrader(grader: AiGrader, options: LongTextAiGradeOptions = {}) {
  return async (
    activity: Activity<'long_text'>,
    response: unknown,
    meta: AttemptMeta,
    signal?: AbortSignalLike,
  ): Promise<GradeResult> => {
    const { text } = longTextResponseSchema.parse(response)
    const input = aiGradeInputFor(activity, text, signal)
    // The local pre-grade runs *before* the port, not only inside it: an empty answer must cost
    // nothing whichever `AiGrader` is wired, including one this package never wrote.
    const pre = preGradeLongText(input)
    const ai = pre.result ?? (await grader(input))
    return aiGradeToGradeResult(ai, activity, text, meta, options)
  }
}
