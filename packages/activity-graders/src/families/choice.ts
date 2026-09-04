import { type Activity, choiceResponseSchema, type PerItem } from '@retenia/activity-schema'
import { PASS_SCORE } from '../constants'
import { type AttemptMeta, mean, result } from './shared'

/**
 * `choice`: all-or-nothing by default; `grading.partialCredit` gives credit per correct pick
 * minus a share per wrong pick; `grading.negativeScoring` subtracts wrong picks from right ones
 * (and wins when both flags are set). `docs/spec/03-activities.md` §2, "common properties".
 */
export function gradeChoice(activity: Activity<'choice'>, response: unknown, meta: AttemptMeta) {
  const answer = choiceResponseSchema.parse(response)
  const { partialCredit, negativeScoring } = activity.grading
  const perItem: PerItem[] = []
  const scores: number[] = []
  const notes: string[] = []

  activity.payload.sets.forEach((set, index) => {
    const selected = [...new Set(answer.sets[index]?.selected ?? [])]
    const correctIds = set.options.filter((option) => option.correct).map((option) => option.id)
    const truePositives = selected.filter((id) => correctIds.includes(id)).length
    const falsePositives = selected.length - truePositives

    let score: number
    if (negativeScoring) {
      score = Math.max(0, (truePositives - falsePositives) / correctIds.length)
    } else if (partialCredit) {
      score = Math.max(0, truePositives / correctIds.length - falsePositives / set.options.length)
    } else {
      score = truePositives === correctIds.length && falsePositives === 0 ? 1 : 0
    }
    scores.push(score)
    perItem.push({
      id: set.id ?? `set-${index}`,
      correct: score === 1,
      expected: correctIds.join(','),
      got: selected.join(','),
    })

    for (const option of set.options) {
      if (selected.includes(option.id) && option.feedback !== undefined) notes.push(option.feedback)
    }
    if (activity.payload.sets.length === 1) {
      const expectedText = set.options
        .filter((option) => option.correct)
        .map((option) => option.text)
        .join(', ')
      if (score === 1) notes.unshift('Correct.')
      else if (score > 0)
        notes.unshift(`Partially correct (${truePositives} of ${correctIds.length}).`)
      else notes.unshift(`Incorrect — the answer was «${expectedText}».`)
    }
  })

  if (activity.payload.sets.length > 1) {
    notes.unshift(`${scores.filter((score) => score === 1).length} of ${scores.length} correct.`)
  }
  const score = mean(scores)
  return result(meta, {
    score,
    correct: score >= PASS_SCORE,
    perItem,
    feedback: notes.join(' '),
    meta: answer.confidence === undefined ? {} : { confidence: answer.confidence },
  })
}
