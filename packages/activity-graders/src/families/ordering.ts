import { type Activity, orderingResponseSchema, type PerItem } from '@retenia/activity-schema'
import { PASS_SCORE } from '../constants'
import { adjacentPairsScore, exactScore, kendallTau, positionScore } from '../ordering/metrics'
import { type AttemptMeta, plural, result } from './shared'

/**
 * `ordering`: scored against the correct order and every alternative, keeping the best.
 * `adjacent-pairs` also reports the pair count `docs/spec/02-memory-system.md` §10's
 * "Order steps" row rates on, as `meta.signals.pairsOutOfOrder`.
 */
export function gradeOrdering(
  activity: Activity<'ordering'>,
  response: unknown,
  meta: AttemptMeta,
) {
  const { order, indents } = orderingResponseSchema.parse(response)
  const { items, correctOrder, alternativeOrders, scoring, checkIndentation } = activity.payload
  const keys = [correctOrder, ...(alternativeOrders ?? [])]

  let score = 0
  let bestKey = correctOrder
  let outOfOrder: number | undefined
  let feedback: string
  if (scoring === 'exact') {
    score = exactScore(order, keys)
    bestKey = keys.find((key) => exactScore(order, [key]) === 1) ?? correctOrder
    feedback = score === 1 ? 'Correct order.' : 'Not the right order.'
  } else {
    for (const key of keys) {
      const candidate =
        scoring === 'adjacent-pairs'
          ? adjacentPairsScore(order, key)
          : scoring === 'kendall'
            ? { score: (kendallTau(order, key).tau + 1) / 2, outOfOrder: undefined }
            : { score: positionScore(order, key), outOfOrder: undefined }
      if (candidate.score > score || key === correctOrder) {
        score = candidate.score
        bestKey = key
        outOfOrder = candidate.outOfOrder
      }
    }
    const inPlace = bestKey.filter((id, i) => order[i] === id).length
    feedback =
      score === 1
        ? 'Correct order.'
        : outOfOrder === undefined
          ? `${inPlace} of ${bestKey.length} in the right place.`
          : `${plural(outOfOrder, 'pair')} out of order.`
  }

  const perItem: PerItem[] = items.map((item) => ({
    id: item.id,
    correct: order.indexOf(item.id) === bestKey.indexOf(item.id) && order.includes(item.id),
    expected: String(bestKey.indexOf(item.id)),
    got: String(order.indexOf(item.id)),
  }))

  if (checkIndentation) {
    const indented = items.filter((item) => item.indent !== undefined)
    if (indented.length > 0) {
      const right = indented.filter((item) => indents?.[item.id] === item.indent).length
      score *= right / indented.length
      if (right < indented.length) feedback += ` ${indented.length - right} indented wrong.`
    }
  }

  return result(meta, {
    score,
    correct: score >= PASS_SCORE,
    perItem,
    feedback,
    meta: outOfOrder === undefined ? {} : { signals: { pairsOutOfOrder: outOfOrder } },
  })
}
