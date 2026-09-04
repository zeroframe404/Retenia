import {
  sampleCards,
  sampleChoice,
  sampleDisclosure,
  sampleOrdering,
  sampleTextInput,
} from '@retenia/activity-schema/testing'
import { RATING } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { gradeActivity } from './grade-activity'
import { rateResult } from './rate'

/** The grader's result through `toRating` (`docs/spec/02-memory-system.md` §10) with the activity's own review block. */
const PERSONAL = { medianMs: 10_000 }
const meta = (timeMs: number, attempts = 1) => ({ timeMs, attempts, hintsUsed: 0 })

describe('rateResult()', () => {
  it('binary: a clean fast answer is Easy, a second attempt is Hard, a miss is Again', () => {
    const choice = sampleChoice()
    const right = { sets: [{ selected: ['a'] }] }
    expect(rateResult(gradeActivity(choice, right, meta(4000)), choice, PERSONAL).rating).toBe(
      RATING.Easy,
    )
    expect(rateResult(gradeActivity(choice, right, meta(9000)), choice, PERSONAL).rating).toBe(
      RATING.Good,
    )
    expect(rateResult(gradeActivity(choice, right, meta(9000, 2)), choice, PERSONAL).rating).toBe(
      RATING.Hard,
    )
    expect(
      rateResult(
        gradeActivity(choice, { sets: [{ selected: ['b'] }] }, meta(9000)),
        choice,
        PERSONAL,
      ).rating,
    ).toBe(RATING.Again)
  })

  it('fuzzy: the similarity band decides', () => {
    const text = sampleTextInput()
    expect(
      rateResult(gradeActivity(text, { value: 'París' }, meta(9000)), text, PERSONAL).rating,
    ).toBe(RATING.Good)
    expect(
      rateResult(gradeActivity(text, { value: 'Parris' }, meta(9000)), text, PERSONAL).rating,
    ).toBe(RATING.Hard)
    expect(
      rateResult(gradeActivity(text, { value: 'Roma' }, meta(9000)), text, PERSONAL).rating,
    ).toBe(RATING.Again)
  })

  it('ordering: the pair count travels from the grader to the rating', () => {
    const ordering = sampleOrdering()
    expect(
      rateResult(
        gradeActivity(ordering, { order: ['i1', 'i3', 'i2', 'i4'] }, meta(9000)),
        ordering,
        PERSONAL,
      ).rating,
    ).toBe(RATING.Hard)
    expect(
      rateResult(
        gradeActivity(ordering, { order: ['i1', 'i2', 'i3', 'i4'] }, meta(9000)),
        ordering,
        PERSONAL,
      ).rating,
    ).toBe(RATING.Good)
    expect(
      rateResult(
        gradeActivity(ordering, { order: ['i4', 'i3', 'i2', 'i1'] }, meta(9000)),
        ordering,
        PERSONAL,
      ).rating,
    ).toBe(RATING.Again)
  })

  it('keeps the user’s own rating on a flashcard and leaves theory blocks unrated', () => {
    const cards = sampleCards()
    expect(
      rateResult(gradeActivity(cards, { rating: 2 }, meta(9000)), cards, PERSONAL).rating,
    ).toBe(RATING.Hard)
    const disclosure = sampleDisclosure()
    expect(
      rateResult(
        gradeActivity(disclosure, { openedIds: ['n1', 'n2'] }, meta(9000)),
        disclosure,
        PERSONAL,
      ).rating,
    ).toBeNull()
  })
})
