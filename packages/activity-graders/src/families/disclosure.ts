import { type Activity, disclosureResponseSchema, type PerItem } from '@retenia/activity-schema'
import { type AttemptMeta, result } from './shared'

/** `disclosure`: completeness only — theory blocks are not review-eligible, so the rating stays `null`. */
export function gradeDisclosure(
  activity: Activity<'disclosure'>,
  response: unknown,
  meta: AttemptMeta,
) {
  const { openedIds } = disclosureResponseSchema.parse(response)
  const opened = new Set(openedIds)
  const perItem: PerItem[] = activity.payload.items.map((item) => ({
    id: item.id,
    correct: opened.has(item.id),
  }))
  const count = perItem.filter((item) => item.correct).length
  return result(meta, {
    score: count / perItem.length,
    correct: count === perItem.length,
    perItem,
    feedback: `Opened ${count} of ${perItem.length} sections.`,
  })
}
