import { type Activity, cardsResponseSchema } from '@retenia/activity-schema'
import { type AttemptMeta, result } from './shared'

/**
 * `cards`: M-self — the user pressed the button, so the rating is theirs and the score merely
 * mirrors it (`Again` 0 … `Easy` 1). Anything from `Hard` up means the card was recalled.
 */
export function gradeCards(_activity: Activity<'cards'>, response: unknown, meta: AttemptMeta) {
  const { rating } = cardsResponseSchema.parse(response)
  return result(meta, { score: (rating - 1) / 3, correct: rating >= 2, feedback: '', rating })
}
