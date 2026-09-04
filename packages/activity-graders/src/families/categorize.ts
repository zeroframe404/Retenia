import { type Activity, categorizeResponseSchema, type PerItem } from '@retenia/activity-schema'
import { PASS_SCORE } from '../constants'
import { type AttemptMeta, mean, result } from './shared'

/** `categorize`: per item, the Jaccard overlap between the groups chosen and the groups expected. */
export function gradeCategorize(
  activity: Activity<'categorize'>,
  response: unknown,
  meta: AttemptMeta,
) {
  const { placements } = categorizeResponseSchema.parse(response)
  const scores: number[] = []
  const perItem: PerItem[] = activity.payload.items.map((item) => {
    const placed = new Set(placements[item.id] ?? [])
    const expected = new Set(item.categoryIds)
    const union = new Set([...placed, ...expected])
    const intersection = [...placed].filter((id) => expected.has(id)).length
    const jaccard = intersection / union.size
    scores.push(jaccard)
    return {
      id: item.id,
      correct: jaccard === 1,
      expected: [...expected].join(','),
      got: [...placed].join(','),
    }
  })
  const score = mean(scores)
  const right = perItem.filter((item) => item.correct).length
  return result(meta, {
    score,
    correct: score >= PASS_SCORE,
    perItem,
    feedback: `${right} of ${perItem.length} items in the right group.`,
  })
}
