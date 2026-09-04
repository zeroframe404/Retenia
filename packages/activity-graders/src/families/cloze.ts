import { type Activity, clozeResponseSchema, type PerItem } from '@retenia/activity-schema'
import { type MatchOptions, matchText } from '../text/match'
import { type AttemptMeta, mean, result } from './shared'

/**
 * `cloze`: each gap is a FUZ match. A typed gap earns its similarity (a near miss is worth
 * something); a dropdown or word-bank gap is right or wrong, since a wrong option is a
 * decision, not a typo. The activity is `correct` when every gap matched.
 */
export function gradeCloze(activity: Activity<'cloze'>, response: unknown, meta: AttemptMeta) {
  const { gaps } = clozeResponseSchema.parse(response)
  const { mode, segments } = activity.payload
  const fuzzy = activity.grading.fuzzy
  const options: MatchOptions = {
    ...(fuzzy?.caseSensitive === undefined ? {} : { caseSensitive: fuzzy.caseSensitive }),
    ...(fuzzy?.ignoreDiacritics === undefined ? {} : { ignoreDiacritics: fuzzy.ignoreDiacritics }),
    ...(fuzzy?.synonyms === undefined ? {} : { synonyms: fuzzy.synonyms }),
    ...(mode === 'typed'
      ? fuzzy?.maxRelativeEditDistance === undefined
        ? {}
        : { maxRelativeEditDistance: fuzzy.maxRelativeEditDistance }
      : { maxRelativeEditDistance: 0 }),
  }

  const perItem: PerItem[] = []
  const scores: number[] = []
  for (const segment of segments) {
    if (segment.kind !== 'gap') continue
    const got = gaps[segment.id] ?? ''
    const match = matchText(got, segment.answers, options)
    scores.push(mode === 'typed' ? match.similarity : match.matched ? 1 : 0)
    perItem.push({
      id: segment.id,
      correct: match.matched,
      expected: segment.answers[0] as string,
      got,
    })
  }

  const matched = perItem.filter((item) => item.correct).length
  return result(meta, {
    score: mean(scores),
    correct: matched === perItem.length,
    perItem,
    feedback:
      matched === perItem.length
        ? `All ${perItem.length} gaps correct.`
        : `${matched} of ${perItem.length} gaps correct.`,
    meta: { engine: 'fuzzy' },
  })
}
