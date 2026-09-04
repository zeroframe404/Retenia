import type { Activity } from '@retenia/activity-schema'
import { sampleChoice } from '@retenia/activity-schema/testing'
import { describe, expect, it } from 'vitest'
import { gradeChoice } from './choice'

const META = { timeMs: 3000, attempts: 1, hintsUsed: 0 }
const twoSets = (): Activity<'choice'> => {
  const base = sampleChoice()
  const set = base.payload.sets[0] as Activity<'choice'>['payload']['sets'][number]
  return {
    ...base,
    type: 'statement_set',
    review: { eligible: true, ratingStrategy: 'partial' },
    payload: {
      family: 'choice',
      sets: [
        { ...set, id: 'x' },
        { ...set, id: undefined, options: set.options.map((o) => ({ ...o, id: `${o.id}2` })) },
      ],
    },
  }
}

describe('gradeChoice()', () => {
  it('copies the declared confidence into meta and lists option feedback', () => {
    const graded = gradeChoice(
      sampleChoice(),
      { sets: [{ selected: ['a'] }], confidence: 'sure' },
      META,
    )
    expect(graded.meta).toEqual({ ...META, confidence: 'sure' })
    expect(graded.feedback).toBe('Correct.')
    const activity = sampleChoice()
    const lyon = activity.payload.sets[0]?.options[1]
    if (lyon === undefined) throw new Error('the sample changed')
    lyon.feedback = 'Lyon es la tercera ciudad.'
    const wrong = gradeChoice(activity, { sets: [{ selected: ['b'] }] }, META)
    expect(wrong.feedback).toBe('Incorrect — the answer was «París». Lyon es la tercera ciudad.')
    expect(wrong.meta.confidence).toBeUndefined()
  })

  it('negative scoring wins over partial credit when both are set', () => {
    const activity = {
      ...sampleChoice(),
      grading: { method: 'det' as const, partialCredit: true, negativeScoring: true },
    }
    // (1 − 1)/1 under negative scoring; 1 − 1/3 under partial credit.
    expect(gradeChoice(activity, { sets: [{ selected: ['a', 'b'] }] }, META).score).toBe(0)
    const partial = { ...sampleChoice(), grading: { method: 'det' as const, partialCredit: true } }
    const graded = gradeChoice(partial, { sets: [{ selected: ['a', 'b'] }] }, META)
    expect(graded.score).toBeCloseTo(2 / 3, 10)
    expect(graded.feedback).toBe('Partially correct (1 of 1).')
  })

  it('summarizes several sets, names unnamed ones, and treats a missing set as unanswered', () => {
    const graded = gradeChoice(twoSets(), { sets: [{ selected: ['a'] }] }, META)
    expect(graded.score).toBe(0.5)
    expect(graded.feedback).toBe('1 of 2 correct.')
    expect(graded.perItem?.map((item) => item.id)).toEqual(['x', 'set-1'])
    expect(graded.perItem?.[1]).toMatchObject({ correct: false, expected: 'a2', got: '' })
  })

  it('rejects a malformed response', () => {
    expect(() => gradeChoice(sampleChoice(), { selected: ['a'] }, META)).toThrow()
  })
})
