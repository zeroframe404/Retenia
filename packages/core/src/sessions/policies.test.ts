import { describe, expect, it } from 'vitest'
import { composeMistakesReview, policyAllowsType, resolvePresentation } from './policies'

const AT = (minutes: number) => new Date(Date.UTC(2026, 5, 1, 9, minutes))

describe('resolvePresentation', () => {
  it('offers hints and immediate feedback for study and review', () => {
    for (const mode of ['study', 'review'] as const) {
      expect(resolvePresentation(mode, 'standard')).toEqual({
        mode,
        hintsAllowed: true,
        deferFeedback: false,
        timed: false,
      })
    }
  })

  it('withholds hints and defers feedback in test mode', () => {
    expect(resolvePresentation('test', 'standard')).toEqual({
      mode: 'test',
      hintsAllowed: false,
      deferFeedback: true,
      timed: true,
    })
  })

  it('never restores a hint that the mode already withheld', () => {
    expect(resolvePresentation('test', 'legendary').hintsAllowed).toBe(false)
  })

  it('puts a clock on screen under Legendary without deferring feedback', () => {
    expect(resolvePresentation('review', 'legendary')).toEqual({
      mode: 'review',
      hintsAllowed: false,
      deferFeedback: false,
      timed: true,
    })
  })
})

describe('policyAllowsType', () => {
  it('bars the word bank under Legendary', () => {
    expect(policyAllowsType('cloze_wordbank', 'legendary')).toBe(false)
    expect(policyAllowsType('sentence_builder', 'legendary')).toBe(false)
  })

  it('leaves everything else alone', () => {
    expect(policyAllowsType('cloze_wordbank', 'standard')).toBe(true)
    expect(policyAllowsType('short_answer', 'legendary')).toBe(true)
  })
})

describe('composeMistakesReview', () => {
  it('queues today’s failed cards, oldest first', () => {
    expect(
      composeMistakesReview([
        { cardId: 'b', rating: 1, reviewedAt: AT(20) },
        { cardId: 'a', rating: 1, reviewedAt: AT(10) },
      ]),
    ).toEqual(['a', 'b'])
  })

  it('drops a card that was answered correctly after failing', () => {
    // It was already retrieved successfully; re-queuing it would punish the attempt that
    // fixed it.
    expect(
      composeMistakesReview([
        { cardId: 'a', rating: 1, reviewedAt: AT(10) },
        { cardId: 'a', rating: 3, reviewedAt: AT(30) },
      ]),
    ).toEqual([])
  })

  it('keeps a card that failed again after a success', () => {
    expect(
      composeMistakesReview([
        { cardId: 'a', rating: 3, reviewedAt: AT(10) },
        { cardId: 'a', rating: 1, reviewedAt: AT(30) },
      ]),
    ).toEqual(['a'])
  })

  it('does not treat Hard as a mistake', () => {
    // §10: "Hard is never assigned to an incorrect answer" — a Hard is a slow success.
    expect(composeMistakesReview([{ cardId: 'a', rating: 2, reviewedAt: AT(10) }])).toEqual([])
  })

  it('ignores a manual reschedule in both directions', () => {
    // Rating 0 is a reschedule, not a retrieval: it can neither fail nor redeem a card.
    expect(
      composeMistakesReview([
        { cardId: 'a', rating: 1, reviewedAt: AT(10) },
        { cardId: 'a', rating: 0, reviewedAt: AT(30) },
      ]),
    ).toEqual(['a'])
  })

  it('keeps only the latest failure of a card', () => {
    expect(
      composeMistakesReview([
        { cardId: 'a', rating: 1, reviewedAt: AT(10) },
        { cardId: 'a', rating: 1, reviewedAt: AT(30) },
      ]),
    ).toEqual(['a'])
  })

  it('breaks a tie on the card id so the queue is reproducible', () => {
    expect(
      composeMistakesReview([
        { cardId: 'b', rating: 1, reviewedAt: AT(10) },
        { cardId: 'a', rating: 1, reviewedAt: AT(10) },
      ]),
    ).toEqual(['a', 'b'])
  })

  it('honours the limit', () => {
    const answers = Array.from({ length: 30 }, (_, index) => ({
      cardId: `c-${String(index).padStart(2, '0')}`,
      rating: 1 as const,
      reviewedAt: AT(index),
    }))
    expect(composeMistakesReview(answers)).toHaveLength(20)
    expect(composeMistakesReview(answers, { limit: 5 })).toHaveLength(5)
  })
})

describe('composeMistakesReview with answers out of order', () => {
  it('keeps the latest failure when an earlier one arrives afterwards', () => {
    // `answers` may arrive in any order — a repository ordering by card, say — so the
    // "latest failure" bookkeeping cannot assume chronology.
    expect(
      composeMistakesReview([
        { cardId: 'a', rating: 1, reviewedAt: AT(30) },
        { cardId: 'a', rating: 1, reviewedAt: AT(10) },
        { cardId: 'a', rating: 3, reviewedAt: AT(20) },
      ]),
    ).toEqual(['a'])
  })

  it('keeps the latest success when an earlier one arrives afterwards', () => {
    expect(
      composeMistakesReview([
        { cardId: 'a', rating: 1, reviewedAt: AT(10) },
        { cardId: 'a', rating: 3, reviewedAt: AT(30) },
        { cardId: 'a', rating: 4, reviewedAt: AT(20) },
      ]),
    ).toEqual([])
  })
})

describe('composeMistakesReview tie-breaking', () => {
  it('orders same-instant failures by card id in both directions', () => {
    // Three tied cards, supplied out of order, so the comparator is exercised both ways —
    // a queue that reordered itself between runs would make "resume" mean something else
    // each time.
    expect(
      composeMistakesReview([
        { cardId: 'c', rating: 1, reviewedAt: AT(10) },
        { cardId: 'a', rating: 1, reviewedAt: AT(10) },
        { cardId: 'b', rating: 1, reviewedAt: AT(10) },
      ]),
    ).toEqual(['a', 'b', 'c'])
  })
})
