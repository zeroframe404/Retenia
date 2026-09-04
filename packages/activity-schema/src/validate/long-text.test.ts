import { describe, expect, it } from 'vitest'
import type { Activity } from '../envelope'
import { sampleLongText } from '../testing/samples'
import { validateLongText } from './long-text'

const codes = (activity: Activity<'long_text'>) =>
  validateLongText(activity).map((issue) => issue.code)
const patch = (
  payload: Partial<Activity<'long_text'>['payload']>,
  rest: Partial<Activity<'long_text'>> = {},
): Activity<'long_text'> => {
  const base = sampleLongText()
  return { ...base, ...rest, payload: { ...base.payload, ...payload } }
}
const rubric = [
  {
    id: 'r1',
    criterion: 'Claridad',
    levels: [
      { score: 0, description: 'no' },
      { score: 1, description: 'sí' },
    ],
  },
]

describe('validateLongText()', () => {
  it('passes the sample', () => {
    expect(codes(sampleLongText())).toEqual([])
  })

  it('word-range-inverted', () => {
    expect(codes(patch({ minWords: 100, maxWords: 50 }))).toEqual(['word-range-inverted'])
    expect(codes(patch({ minWords: 50, maxWords: 100 }))).toEqual([])
  })

  it('key-points-required for free_recall and list_recall', () => {
    expect(codes(patch({ keyPoints: [] }))).toEqual(['key-points-required'])
    const list = patch(
      { keyPoints: undefined },
      {
        type: 'list_recall',
        grading: { method: 'fuzzy' },
        review: { eligible: true, ratingStrategy: 'partial' },
      },
    )
    expect(codes(list)).toEqual(['key-points-required'])
  })

  it('rubric-required and model-answer-required for essay_rubric', () => {
    const essay = (payload: Partial<Activity<'long_text'>['payload']>) =>
      patch({ keyPoints: undefined, ...payload }, { type: 'essay_rubric' })
    expect(codes(essay({}))).toEqual(['rubric-required', 'model-answer-required'])
    expect(codes(essay({ rubric, modelAnswer: 'La fotosíntesis…' }))).toEqual([])
  })

  it('rubric-level-scores-duplicate', () => {
    const dup = [
      {
        id: 'r1',
        criterion: 'c',
        levels: [
          { score: 1, description: 'a' },
          { score: 1, description: 'b' },
        ],
      },
    ]
    expect(codes(patch({ rubric: dup }))).toEqual(['rubric-level-scores-duplicate'])
  })

  it('answer-in-prompt for a key point or alias in the prompt', () => {
    expect(codes(patch({}, { prompt: 'Explicá cómo la luz solar produce glucosa.' }))).toEqual([
      'answer-in-prompt',
      'answer-in-prompt',
    ])
    expect(codes(patch({}, { prompt: 'Explicá el rol del CO2.' }))).toEqual(['answer-in-prompt'])
  })
})
