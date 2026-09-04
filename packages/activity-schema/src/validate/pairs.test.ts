import { describe, expect, it } from 'vitest'
import type { Activity } from '../envelope'
import { samplePairs } from '../testing/samples'
import { validatePairs } from './pairs'

const codes = (activity: Activity<'pairs'>) => validatePairs(activity).map((issue) => issue.code)
const patch = (
  payload: Partial<Activity<'pairs'>['payload']>,
  rest: Partial<Activity<'pairs'>> = {},
): Activity<'pairs'> => {
  const base = samplePairs()
  return { ...base, ...rest, payload: { ...base.payload, ...payload } }
}

describe('validatePairs()', () => {
  it('passes the sample', () => {
    expect(codes(samplePairs())).toEqual([])
  })

  it('pairs-left-duplicate and pairs-right-duplicate compare normalized text', () => {
    const pairs = samplePairs().payload.pairs
    expect(
      codes(patch({ pairs: [...pairs, { id: 'p4', left: 'FRANCIA', right: 'Niza' }] })),
    ).toEqual(['pairs-left-duplicate'])
    expect(
      codes(patch({ pairs: [...pairs, { id: 'p4', left: 'Portugal', right: 'paris' }] })),
    ).toEqual(['pairs-right-duplicate'])
  })

  it('pairs-distractor-is-answer', () => {
    expect(codes(patch({ rightDistractors: [{ id: 'd1', text: 'Roma' }] }))).toEqual([
      'pairs-distractor-is-answer',
    ])
  })

  it('pairs-presentation-mismatch and pairs-time-limit-required', () => {
    expect(codes(patch({ presentation: 'dropdown' }))).toEqual(['pairs-presentation-mismatch'])
    expect(codes(patch({ presentation: 'lines' }))).toEqual([])
    const timed = {
      type: 'tap_pairs_timed' as const,
      review: { eligible: true, ratingStrategy: 'partial' as const },
    }
    expect(codes(patch({ presentation: 'tap-timed' }, timed))).toEqual([
      'pairs-time-limit-required',
    ])
    expect(codes(patch({ presentation: 'tap-timed', timeLimitSec: 30 }, timed))).toEqual([])
  })
})
