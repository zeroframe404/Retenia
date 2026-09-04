import type { Activity } from '@retenia/activity-schema'
import { sampleOrdering } from '@retenia/activity-schema/testing'
import { describe, expect, it } from 'vitest'
import { gradeOrdering } from './ordering'

const META = { timeMs: 5000, attempts: 1, hintsUsed: 0 }
const withPayload = (payload: Partial<Activity<'ordering'>['payload']>): Activity<'ordering'> => ({
  ...sampleOrdering(),
  payload: { ...sampleOrdering().payload, ...payload },
})

describe('gradeOrdering()', () => {
  it('exact: any key counts, and the matching key names the per-item verdicts', () => {
    const activity = withPayload({
      scoring: 'exact',
      alternativeOrders: [['i2', 'i1', 'i3', 'i4']],
    })
    const alt = gradeOrdering(activity, { order: ['i2', 'i1', 'i3', 'i4'] }, META)
    expect(alt).toMatchObject({ score: 1, correct: true, feedback: 'Correct order.' })
    expect(alt.perItem?.every((item) => item.correct)).toBe(true)
    expect(alt.meta.signals).toBeUndefined()
    const wrong = gradeOrdering(activity, { order: ['i3', 'i1', 'i2', 'i4'] }, META)
    expect(wrong).toMatchObject({ score: 0, correct: false, feedback: 'Not the right order.' })
    expect(wrong.perItem?.map((item) => item.correct)).toEqual([false, false, false, true])
  })

  it('adjacent pairs: reports the pair count as a rating signal and keeps the best key', () => {
    const activity = withPayload({
      alternativeOrders: [
        ['i1', 'i3', 'i2', 'i4'],
        ['i4', 'i3', 'i2', 'i1'],
      ],
    })
    const graded = gradeOrdering(activity, { order: ['i1', 'i3', 'i2', 'i4'] }, META)
    expect(graded).toMatchObject({
      score: 1,
      correct: true,
      meta: { signals: { pairsOutOfOrder: 0 } },
    })
    const one = gradeOrdering(sampleOrdering(), { order: ['i1', 'i3', 'i2', 'i4'] }, META)
    expect(one.feedback).toBe('1 pair out of order.')
    expect(one.meta.signals).toEqual({ pairsOutOfOrder: 1 })
    expect(
      gradeOrdering(sampleOrdering(), { order: ['i4', 'i3', 'i2', 'i1'] }, META).feedback,
    ).toBe('3 pairs out of order.')
  })

  it('kendall and position scorings', () => {
    const kendall = gradeOrdering(
      withPayload({ scoring: 'kendall' }),
      { order: ['i1', 'i3', 'i2', 'i4'] },
      META,
    )
    expect(kendall.score).toBeCloseTo(5 / 6, 10)
    expect(kendall.feedback).toBe('2 of 4 in the right place.')
    const position = gradeOrdering(
      withPayload({ scoring: 'position' }),
      { order: ['i2', 'i1', 'i3', 'i4'] },
      META,
    )
    expect(position).toMatchObject({
      score: 0.5,
      correct: false,
      feedback: '2 of 4 in the right place.',
    })
    expect(
      position.perItem?.map((item) => [item.id, item.correct, item.expected, item.got]),
    ).toEqual([
      ['i1', false, '0', '1'],
      ['i2', false, '1', '0'],
      ['i3', true, '2', '2'],
      ['i4', true, '3', '3'],
    ])
  })

  it('a missing item is never in place', () => {
    const graded = gradeOrdering(
      withPayload({ scoring: 'position' }),
      { order: ['i1', 'i2', 'i3'] },
      META,
    )
    expect(graded.perItem?.[3]).toMatchObject({ id: 'i4', correct: false, got: '-1' })
  })

  it('indentation multiplies the score when the activity checks it', () => {
    const items = sampleOrdering().payload.items.map((item, i) => ({ ...item, indent: i % 2 }))
    const activity = withPayload({ items, checkIndentation: true, scoring: 'exact' })
    const order = ['i1', 'i2', 'i3', 'i4']
    expect(
      gradeOrdering(activity, { order, indents: { i1: 0, i2: 1, i3: 0, i4: 1 } }, META),
    ).toMatchObject({ score: 1, feedback: 'Correct order.' })
    expect(
      gradeOrdering(activity, { order, indents: { i1: 0, i2: 0, i3: 0, i4: 1 } }, META),
    ).toMatchObject({ score: 0.75, correct: false, feedback: 'Correct order. 1 indented wrong.' })
    expect(gradeOrdering(activity, { order }, META).score).toBe(0)
    const noIndents = withPayload({ checkIndentation: true, scoring: 'exact' })
    expect(gradeOrdering(noIndents, { order }, META).score).toBe(1)
  })
})
