import { describe, expect, it } from 'vitest'
import { measureOutcome } from './outcome'

const NOW = new Date('2026-09-11T12:00:00Z')

describe('measureOutcome()', () => {
  it('counts graded attempts and ignores a null correct', () => {
    const result = measureOutcome({
      attempts: [{ correct: true }, { correct: false }, { correct: null }],
      reviews: [],
      now: NOW,
    })
    expect(result.attempts).toBe(2)
    expect(result.correct).toBe(1)
  })

  it('excludes rating-0 reviews (a postpone) from the review count', () => {
    const result = measureOutcome({
      attempts: [],
      reviews: [{ rating: 0 }, { rating: 3 }, { rating: 4 }],
      now: NOW,
    })
    expect(result.reviews).toBe(2)
  })

  it('counts a review as clean at rating >= 3', () => {
    const result = measureOutcome({
      attempts: [],
      reviews: [{ rating: 2 }, { rating: 3 }, { rating: 4 }],
      now: NOW,
    })
    expect(result.reviews).toBe(3)
    expect(result.clean_reviews).toBe(2)
  })

  it('computes accuracy as (correct + clean) / (attempts + reviews), rounded to 3 decimals', () => {
    const result = measureOutcome({
      attempts: [{ correct: true }, { correct: false }],
      reviews: [{ rating: 3 }, { rating: 4 }],
      now: NOW,
    })
    // correct=1, clean=2, total=4 -> 3/4 = 0.75
    expect(result.accuracy).toBe(0.75)
  })

  it('rounds a repeating decimal to 3 places', () => {
    const result = measureOutcome({
      attempts: [{ correct: true }],
      reviews: [{ rating: 3 }, { rating: 1 }],
      now: NOW,
    })
    // correct=1, clean=1, attempts=1, reviews=2 (rating 1 counted as a review, not clean) -> total=3
    // (1 + 1) / 3 = 0.6666... -> 0.667
    expect(result.accuracy).toBe(0.667)
  })

  it('is null when there is nothing to measure', () => {
    const result = measureOutcome({ attempts: [], reviews: [], now: NOW })
    expect(result).toEqual({
      attempts: 0,
      correct: 0,
      reviews: 0,
      clean_reviews: 0,
      accuracy: null,
      measured_at: NOW.toISOString(),
    })
  })

  it('is null when only ungraded attempts and postponed reviews exist', () => {
    const result = measureOutcome({
      attempts: [{ correct: null }],
      reviews: [{ rating: 0 }],
      now: NOW,
    })
    expect(result.accuracy).toBeNull()
  })

  it('sets measured_at to now, as an ISO string', () => {
    const result = measureOutcome({ attempts: [], reviews: [], now: NOW })
    expect(result.measured_at).toBe(NOW.toISOString())
  })
})
