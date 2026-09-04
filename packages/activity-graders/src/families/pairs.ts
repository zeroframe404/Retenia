import { type Activity, type PerItem, pairsResponseSchema } from '@retenia/activity-schema'
import { PASS_SCORE } from '../constants'
import { type AttemptMeta, result } from './shared'

/** `pairs`: the fraction of pairs whose left side was matched to its own right side. The first match of a left wins. */
export function gradePairs(activity: Activity<'pairs'>, response: unknown, meta: AttemptMeta) {
  const { matches } = pairsResponseSchema.parse(response)
  const perItem: PerItem[] = activity.payload.pairs.map((pair) => {
    const match = matches.find((candidate) => candidate.left === pair.id)
    const got = match?.right ?? ''
    return { id: pair.id, correct: got === pair.id, expected: pair.id, got }
  })
  const matched = perItem.filter((item) => item.correct).length
  const score = matched / perItem.length
  return result(meta, {
    score,
    correct: score >= PASS_SCORE,
    perItem,
    feedback: `${matched} of ${perItem.length} pairs matched.`,
  })
}
