import {
  type Activity,
  longTextResponseSchema,
  normalizeText,
  type PerItem,
} from '@retenia/activity-schema'
import { DEFAULT_MAX_RELATIVE_EDIT_DISTANCE, PASS_SCORE } from '../constants'
import { relativeDistance } from '../text/distance'
import { type AttemptMeta, result } from './shared'

/**
 * `long_text`: weighted key-point coverage — `list_recall`'s FUZ set-match
 * (`docs/spec/03-activities.md` §4 row 7). For `free_recall` and `essay_rubric` it is the
 * deterministic pre-score; the AI rubric grader (sub-phase 5.5) overwrites `engine`.
 */

/** Whether `phrase` occurs in `text`, verbatim after normalization or as a token window within FUZ distance. */
export function coversPhrase(text: string, phrase: string): boolean {
  const haystack = normalizeText(text)
  const needle = normalizeText(phrase)
  if (needle.length === 0) return false
  if (haystack.includes(needle)) return true
  const tokens = haystack.split(' ')
  const width = needle.split(' ').length
  for (const size of [width - 1, width, width + 1]) {
    if (size < 1) continue
    for (let start = 0; start + size <= tokens.length; start++) {
      const window = tokens.slice(start, start + size).join(' ')
      if (relativeDistance(window, needle) <= DEFAULT_MAX_RELATIVE_EDIT_DISTANCE) return true
    }
  }
  return false
}

export function gradeLongText(
  activity: Activity<'long_text'>,
  response: unknown,
  meta: AttemptMeta,
) {
  const { text } = longTextResponseSchema.parse(response)
  const keyPoints = activity.payload.keyPoints ?? []
  if (keyPoints.length === 0) {
    return result(meta, {
      score: 0,
      correct: false,
      perItem: [],
      feedback: 'No key points to grade.',
      meta: { engine: 'keypoints' },
    })
  }

  let total = 0
  let covered = 0
  const perItem: PerItem[] = keyPoints.map((point) => {
    const weight = point.weight ?? 1
    const hit = [point.text, ...(point.aliases ?? [])].some((phrase) => coversPhrase(text, phrase))
    total += weight
    if (hit) covered += weight
    return { id: point.id, correct: hit, expected: point.text }
  })
  const score = covered / total
  const hits = perItem.filter((item) => item.correct).length
  return result(meta, {
    score,
    correct: score >= PASS_SCORE,
    perItem,
    feedback: `Covered ${hits} of ${keyPoints.length} key points.`,
    meta: { engine: 'keypoints' },
  })
}
