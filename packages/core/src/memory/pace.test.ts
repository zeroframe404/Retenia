import { describe, expect, it } from 'vitest'
import { type ActivityPace, foldPace, medianOf, PACE_SAMPLE_SIZE } from './pace'

describe('medianOf', () => {
  it('has no median for an empty sample', () => {
    expect(medianOf([])).toBeNull()
  })

  it('is the middle value of an odd sample, whatever order it arrived in', () => {
    expect(medianOf([9_000, 1_000, 5_000])).toBe(5_000)
  })

  it('takes the lower of the two middles, as medianDurationMs’s OFFSET n/2 does', () => {
    expect(medianOf([1_000, 3_000, 5_000, 9_000])).toBe(3_000)
  })

  it('never reports a median below 1 ms, which the CHECK constraint forbids', () => {
    expect(medianOf([0.2])).toBe(1)
  })
})

describe('foldPace', () => {
  const fold = (pace: ActivityPace | undefined, ms: number, size?: number) =>
    foldPace(pace, 'mcq_single', ms, size)

  it('starts a type’s history on its first measured review', () => {
    const pace = fold(undefined, 8_000)
    expect(pace).toEqual({
      activityType: 'mcq_single',
      reviews: 1,
      medianMs: 8_000,
      sample: [8_000],
    })
  })

  it('recomputes the median as measurements arrive', () => {
    let pace = fold(undefined, 10_000)
    pace = fold(pace, 2_000)
    pace = fold(pace, 6_000)
    expect(pace.sample).toEqual([10_000, 2_000, 6_000])
    expect(pace.medianMs).toBe(6_000)
    expect(pace.reviews).toBe(3)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'ignores %s: an unmeasured answer is not evidence that the type takes no time',
    (durationMs) => {
      const pace = fold(undefined, 5_000)
      expect(fold(pace, durationMs)).toEqual(pace)
    },
  )

  it('bounds the window and drops the oldest measurements first', () => {
    let pace = fold(undefined, 1_000, 3)
    for (const ms of [2_000, 3_000, 4_000]) pace = fold(pace, ms, 3)
    expect(pace.sample).toEqual([2_000, 3_000, 4_000])
    // `reviews` counts everything ever folded in, not the window's length.
    expect(pace.reviews).toBe(4)
  })

  it('follows a user who gets faster instead of averaging their first week in forever', () => {
    // Ten slow answers, then ten fast ones, through a window that only holds ten.
    let pace: ActivityPace | undefined
    for (let i = 0; i < 10; i++) pace = fold(pace, 30_000, 10)
    expect(pace?.medianMs).toBe(30_000)
    for (let i = 0; i < 10; i++) pace = fold(pace, 3_000, 10)
    expect(pace?.medianMs).toBe(3_000)
  })

  it('keeps the sample bounded at the default size over a long history', () => {
    let pace: ActivityPace | undefined
    for (let i = 0; i < PACE_SAMPLE_SIZE * 2; i++) pace = fold(pace, 1_000 + i)
    expect(pace?.sample).toHaveLength(PACE_SAMPLE_SIZE)
    expect(pace?.reviews).toBe(PACE_SAMPLE_SIZE * 2)
  })

  it('rounds to whole milliseconds, which is what the INTEGER column stores', () => {
    expect(fold(undefined, 1_234.7).sample).toEqual([1_235])
  })
})
