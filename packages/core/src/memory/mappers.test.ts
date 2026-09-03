import type { Card as FsrsCard, ReviewLog as FsrsReviewLog } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import type { Card, CardState, Rating } from '../entities'
import { cardFixture, reviewLogFixture } from '../testing/memory-fixtures'
import { fromFsrsCard, fromFsrsReviewLog, toFsrsCard, toFsrsReviewLog } from './mappers'

const STATES: CardState[] = [0, 1, 2, 3]
const RATINGS: Rating[] = [0, 1, 2, 3, 4]

describe('toFsrsCard / fromFsrsCard', () => {
  it('maps every FSRS field by name and keeps the units', () => {
    const card = cardFixture({
      due: new Date('2026-02-01T10:00:00Z'),
      stability: 12.5,
      difficulty: 6.25,
      scheduledDays: 12,
      learningSteps: 1,
      reps: 7,
      lapses: 2,
      state: 2,
      lastReview: new Date('2026-01-20T10:00:00Z'),
    })
    expect(toFsrsCard(card)).toEqual({
      due: new Date('2026-02-01T10:00:00Z'),
      stability: 12.5,
      difficulty: 6.25,
      elapsed_days: 0,
      scheduled_days: 12,
      learning_steps: 1,
      reps: 7,
      lapses: 2,
      state: 2,
      last_review: new Date('2026-01-20T10:00:00Z'),
    })
  })

  it('round-trips in every state, with and without a last review', () => {
    for (const state of STATES) {
      for (const lastReview of [null, new Date('2026-01-20T10:00:00Z')]) {
        const card = cardFixture({ state, lastReview, stability: state === 0 ? 0 : 3.3 })
        const back = fromFsrsCard(toFsrsCard(card), card)
        expect(back).toEqual(card)
        expect(back).not.toBe(card)
      }
    }
  })

  it('never shares Date instances across the boundary', () => {
    const card = cardFixture({ lastReview: new Date('2026-01-20T10:00:00Z'), state: 2 })
    const fsrsCard = toFsrsCard(card)
    expect(fsrsCard.due).not.toBe(card.due)
    expect(fsrsCard.last_review).not.toBe(card.lastReview)
    const back = fromFsrsCard(fsrsCard, card)
    expect(back.due).not.toBe(fsrsCard.due)
    expect(back.lastReview).not.toBe(fsrsCard.last_review)
  })

  it('leaves a missing last review undefined for ts-fsrs and null for the domain', () => {
    expect(toFsrsCard(cardFixture({ lastReview: null })).last_review).toBeUndefined()
    const fsrsCard: FsrsCard = { ...toFsrsCard(cardFixture()), last_review: undefined }
    expect(fromFsrsCard(fsrsCard, cardFixture()).lastReview).toBeNull()
  })

  it('preserves everything that is not FSRS’s on the way back', () => {
    const card = cardFixture({
      template: 'cloze:c2',
      suspended: true,
      examId: 'exam-1',
      version: 4,
    })
    const fsrsCard = toFsrsCard(card)
    fsrsCard.stability = 99
    const back: Card = fromFsrsCard(fsrsCard, card)
    expect(back).toMatchObject({
      template: 'cloze:c2',
      suspended: true,
      examId: 'exam-1',
      version: 4,
    })
    expect(back.stability).toBe(99)
  })

  it('rejects a state ts-fsrs should never produce', () => {
    const broken = { ...toFsrsCard(cardFixture()), state: 7 as never }
    expect(() => fromFsrsCard(broken, cardFixture())).toThrow(RangeError)
  })
})

describe('toFsrsReviewLog / fromFsrsReviewLog', () => {
  it('maps the nine fields, writes last_elapsed_days as 0, and stamps the algorithm', () => {
    const log = reviewLogFixture({
      rating: 2,
      state: 3,
      due: new Date('2026-01-20T10:00:00Z'),
      stability: 4.5,
      difficulty: 7.1,
      elapsedDays: -2,
      scheduledDays: 9,
      learningSteps: 1,
      review: new Date('2026-01-21T10:00:00Z'),
    })
    const fsrsLog = toFsrsReviewLog(log)
    expect(fsrsLog).toEqual({
      rating: 2,
      state: 3,
      due: new Date('2026-01-20T10:00:00Z'),
      stability: 4.5,
      difficulty: 7.1,
      elapsed_days: -2,
      last_elapsed_days: 0,
      scheduled_days: 9,
      learning_steps: 1,
      review: new Date('2026-01-21T10:00:00Z'),
    })
    expect(fromFsrsReviewLog(fsrsLog, log.cardId)).toEqual({
      cardId: log.cardId,
      rating: 2,
      state: 3,
      due: new Date('2026-01-20T10:00:00Z'),
      stability: 4.5,
      difficulty: 7.1,
      elapsedDays: -2,
      scheduledDays: 9,
      learningSteps: 1,
      review: new Date('2026-01-21T10:00:00Z'),
      algorithmVersion: 'fsrs6',
    })
  })

  it('round-trips every rating and state', () => {
    for (const rating of RATINGS) {
      for (const state of STATES) {
        const log = reviewLogFixture({ rating, state })
        const back = fromFsrsReviewLog(toFsrsReviewLog(log), log.cardId)
        expect(back.rating).toBe(rating)
        expect(back.state).toBe(state)
      }
    }
  })

  it('copies the dates', () => {
    const log = reviewLogFixture()
    const fsrsLog = toFsrsReviewLog(log)
    expect(fsrsLog.due).not.toBe(log.due)
    expect(fsrsLog.review).not.toBe(log.review)
    const back = fromFsrsReviewLog(fsrsLog, log.cardId)
    expect(back.due).not.toBe(fsrsLog.due)
    expect(back.review).not.toBe(fsrsLog.review)
  })

  it('rejects an unknown rating or state', () => {
    const fsrsLog: FsrsReviewLog = toFsrsReviewLog(reviewLogFixture())
    expect(() => fromFsrsReviewLog({ ...fsrsLog, rating: 9 as never }, 'c')).toThrow(RangeError)
    expect(() => fromFsrsReviewLog({ ...fsrsLog, state: -1 as never }, 'c')).toThrow(RangeError)
  })
})
