import type { Activity, GradeResult } from '@retenia/activity-schema'
import { toReviewSpec } from '@retenia/activity-schema'
import { type PersonalPace, toRating } from '@retenia/core'

/**
 * Fills `rating` from the activity's `review` block through `@retenia/core`'s `toRating`
 * (`docs/spec/02-memory-system.md` §10), passing along the ordering signal. A rating the
 * grader already set (M-self, where the user pressed the button) is kept when `toRating`
 * has nothing to say.
 */
export function rateResult(
  result: GradeResult,
  activity: Activity,
  personal: PersonalPace,
): GradeResult {
  const rating = toRating(result, toReviewSpec(activity), personal, result.meta.signals ?? {})
  return { ...result, rating: rating ?? result.rating }
}
