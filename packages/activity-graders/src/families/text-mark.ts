import { type Activity, type PerItem, textMarkResponseSchema } from '@retenia/activity-schema'
import { PASS_SCORE } from '../constants'
import { type AttemptMeta, result } from './shared'

/** `text_mark`: precision and recall over the marked tokens, combined as F1 (H5P "Mark the Words" partial credit). */
export function gradeTextMark(
  activity: Activity<'text_mark'>,
  response: unknown,
  meta: AttemptMeta,
) {
  const { markedIds } = textMarkResponseSchema.parse(response)
  const tokens = new Set(activity.payload.tokens.map((token) => token.id))
  const marked = new Set(markedIds.filter((id) => tokens.has(id)))
  const correct = new Set(activity.payload.correctIds)
  const hits = [...marked].filter((id) => correct.has(id)).length
  const precision = marked.size === 0 ? 0 : hits / marked.size
  const recall = hits / correct.size
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)

  const perItem: PerItem[] = activity.payload.tokens
    .filter((token) => correct.has(token.id) || marked.has(token.id))
    .map((token) => ({ id: token.id, correct: correct.has(token.id) === marked.has(token.id) }))
  return result(meta, {
    score: f1,
    correct: f1 >= PASS_SCORE,
    perItem,
    feedback: `Marked ${hits} of ${correct.size} target words; ${marked.size - hits} extra.`,
  })
}
