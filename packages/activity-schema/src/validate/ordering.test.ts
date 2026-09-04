import { describe, expect, it } from 'vitest'
import type { Activity } from '../envelope'
import { sampleOrdering } from '../testing/samples'
import { validateOrdering } from './ordering'

const codes = (activity: Activity<'ordering'>) =>
  validateOrdering(activity).map((issue) => issue.code)
const patch = (
  payload: Partial<Activity<'ordering'>['payload']>,
  rest: Partial<Activity<'ordering'>> = {},
): Activity<'ordering'> => {
  const base = sampleOrdering()
  return { ...base, ...rest, payload: { ...base.payload, ...payload } }
}

/** §11: "`correctOrder` is a permutation". */
describe('validateOrdering()', () => {
  it('passes the sample', () => {
    expect(codes(sampleOrdering())).toEqual([])
  })

  it('order-not-permutation: missing, repeated, unknown or distractor ids', () => {
    expect(codes(patch({ correctOrder: ['i1', 'i2', 'i3'] }))).toEqual(['order-not-permutation'])
    expect(codes(patch({ correctOrder: ['i1', 'i2', 'i3', 'i3'] }))).toEqual([
      'order-not-permutation',
    ])
    expect(codes(patch({ correctOrder: ['i1', 'i2', 'i3', 'i9'] }))).toEqual([
      'order-not-permutation',
    ])
    expect(
      codes(
        patch({
          distractors: [{ id: 'd1', text: 'Publicación' }],
          correctOrder: ['i1', 'i2', 'i3', 'i4', 'd1'],
        }),
      ),
    ).toEqual(['order-not-permutation'])
  })

  it('alt-order-not-permutation and alt-order-equals-correct', () => {
    expect(codes(patch({ alternativeOrders: [['i2', 'i1', 'i3']] }))).toEqual([
      'alt-order-not-permutation',
    ])
    const issues = validateOrdering(
      patch({
        alternativeOrders: [
          ['i1', 'i2', 'i3', 'i4'],
          ['i2', 'i1', 'i3', 'i4'],
        ],
      }),
    )
    expect(issues.map((issue) => [issue.code, issue.severity])).toEqual([
      ['alt-order-equals-correct', 'warning'],
    ])
  })

  it('ordering-scoring-mismatch: sentence_builder and anagram are exact', () => {
    const sentence = patch(
      { scoring: 'kendall' },
      { type: 'sentence_builder', review: { eligible: true, ratingStrategy: 'binary' } },
    )
    expect(codes(sentence)).toEqual(['ordering-scoring-mismatch'])
    expect(codes({ ...sentence, payload: { ...sentence.payload, scoring: 'exact' } })).toEqual([])
  })

  it('ordering-indent-missing and ordering-distractor-is-item', () => {
    expect(codes(patch({ checkIndentation: true }))).toEqual(['ordering-indent-missing'])
    const items = sampleOrdering().payload.items.map((item) => ({ ...item, indent: 0 }))
    expect(codes(patch({ checkIndentation: true, items }))).toEqual([])
    expect(codes(patch({ distractors: [{ id: 'd1', text: 'hipótesis' }] }))).toEqual([
      'ordering-distractor-is-item',
    ])
  })
})
