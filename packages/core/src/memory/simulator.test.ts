import { describe, expect, it } from 'vitest'
import { DEFAULT_FSRS_W } from './parameters'
import {
  DEFAULT_SIMULATOR_CONFIG,
  RATING_PROBABILITY_MIN_SAMPLE,
  ratingProbabilitiesFrom,
  relativeWorkload,
  SIMULATOR_MAX_DECK_SIZE,
  SIMULATOR_MAX_SPAN_DAYS,
  simulate,
  workloadSummary,
} from './simulator'

describe('§6 — simulate', () => {
  it('is deterministic: the same seed yields a deeply equal result', () => {
    const a = simulate(DEFAULT_FSRS_W, 0.9, {}, 42)
    const b = simulate(DEFAULT_FSRS_W, 0.9, {}, 42)
    expect(a).toEqual(b)
  })

  it('is not deterministic across seeds', () => {
    const a = simulate(DEFAULT_FSRS_W, 0.9, {}, 1)
    const b = simulate(DEFAULT_FSRS_W, 0.9, {}, 2)
    expect(a).not.toEqual(b)
  })

  it('produces one entry per simulated day, in every series', () => {
    const result = simulate(DEFAULT_FSRS_W, 0.9, { learnSpan: 30 })
    expect(result.memorizedCntPerDay).toHaveLength(30)
    expect(result.reviewCntPerDay).toHaveLength(30)
    expect(result.learnCntPerDay).toHaveLength(30)
    expect(result.costPerDay).toHaveLength(30)
    expect(result.correctCntPerDay).toHaveLength(30)
    expect(result.introducedCntPerDay).toHaveLength(30)
  })

  it('rises reviews/day with desired retention, in roughly the documented shape', () => {
    // §7's simulator, measured on `DEFAULT_SIMULATOR_CONFIG` at deckSize 2000: pinned
    // approximately (≈31/54/91 reviews a day), not exactly, so an unrelated formula fix
    // does not make this test brittle.
    const config = { deckSize: 2000, learnSpan: 365 }
    const at080 = workloadSummary(simulate(DEFAULT_FSRS_W, 0.8, config)).reviewsPerDay
    const at090 = workloadSummary(simulate(DEFAULT_FSRS_W, 0.9, config)).reviewsPerDay
    const at095 = workloadSummary(simulate(DEFAULT_FSRS_W, 0.95, config)).reviewsPerDay
    expect(at080).toBeGreaterThan(15)
    expect(at080).toBeLessThan(50)
    expect(at090).toBeGreaterThan(at080)
    expect(at090).toBeGreaterThan(35)
    expect(at090).toBeLessThan(75)
    expect(at095).toBeGreaterThan(at090)
    expect(at095).toBeGreaterThan(70)
    expect(at095).toBeLessThan(120)
  })

  it('achieves roughly the retention it targets', () => {
    for (const dr of [0.8, 0.9, 0.95]) {
      const summary = workloadSummary(simulate(DEFAULT_FSRS_W, dr, { deckSize: 2000 }))
      expect(Math.abs(summary.trueRetention - dr)).toBeLessThan(0.02)
    }
  })

  it('never exceeds maxCostPerday nor reviewLimit', () => {
    const result = simulate(DEFAULT_FSRS_W, 0.9, {
      deckSize: 5000,
      learnSpan: 200,
      maxCostPerday: 300,
      reviewLimit: 20,
    })
    for (const cost of result.costPerDay) expect(cost).toBeLessThanOrEqual(300)
    for (const reviews of result.reviewCntPerDay) expect(reviews).toBeLessThanOrEqual(20)
  })

  it('newCardsIgnoreReviewLimit changes how many cards get introduced when reviewLimit is small', () => {
    const shared = { deckSize: 5000, learnSpan: 60, reviewLimit: 1, learnLimit: 10 }
    const capped = simulate(DEFAULT_FSRS_W, 0.9, { ...shared, newCardsIgnoreReviewLimit: false })
    const uncapped = simulate(DEFAULT_FSRS_W, 0.9, { ...shared, newCardsIgnoreReviewLimit: true })
    const cappedIntroduced = capped.introducedCntPerDay.at(-1) ?? 0
    const uncappedIntroduced = uncapped.introducedCntPerDay.at(-1) ?? 0
    expect(uncappedIntroduced).toBeGreaterThan(cappedIntroduced)
  })

  it('suspendAfterLapses stops a card coming back; null never suspends', () => {
    const withSuspend = simulate(DEFAULT_FSRS_W, 0.7, {
      deckSize: 50,
      learnSpan: 730,
      suspendAfterLapses: 1,
    })
    const withoutSuspend = simulate(DEFAULT_FSRS_W, 0.7, {
      deckSize: 50,
      learnSpan: 730,
      suspendAfterLapses: null,
    })
    const totalWithSuspend = withSuspend.reviewCntPerDay.reduce((a, b) => a + b, 0)
    const totalWithoutSuspend = withoutSuspend.reviewCntPerDay.reduce((a, b) => a + b, 0)
    expect(totalWithSuspend).toBeLessThan(totalWithoutSuspend)
  })

  it('caps introducedCntPerDay at deckSize', () => {
    const result = simulate(DEFAULT_FSRS_W, 0.9, {
      deckSize: 10,
      learnSpan: 100,
      learnLimit: 50,
      reviewLimit: 1000,
      newCardsIgnoreReviewLimit: true,
    })
    for (const introduced of result.introducedCntPerDay) expect(introduced).toBeLessThanOrEqual(10)
    expect(result.introducedCntPerDay.at(-1)).toBe(10)
  })

  it('throws for a desiredRetention of 0, 1 or NaN', () => {
    expect(() => simulate(DEFAULT_FSRS_W, 0)).toThrow(RangeError)
    expect(() => simulate(DEFAULT_FSRS_W, 1)).toThrow(RangeError)
    expect(() => simulate(DEFAULT_FSRS_W, Number.NaN)).toThrow(RangeError)
  })

  it('throws for a negative learnSpan or one over SIMULATOR_MAX_SPAN_DAYS', () => {
    expect(() => simulate(DEFAULT_FSRS_W, 0.9, { learnSpan: -1 })).toThrow(RangeError)
    expect(() => simulate(DEFAULT_FSRS_W, 0.9, { learnSpan: SIMULATOR_MAX_SPAN_DAYS + 1 })).toThrow(
      RangeError,
    )
  })

  it('throws for a deckSize over SIMULATOR_MAX_DECK_SIZE', () => {
    expect(() => simulate(DEFAULT_FSRS_W, 0.9, { deckSize: SIMULATOR_MAX_DECK_SIZE + 1 })).toThrow(
      RangeError,
    )
  })
})

describe('§13 — workloadSummary', () => {
  it('returns zeros for an empty-span result', () => {
    const result = simulate(DEFAULT_FSRS_W, 0.9, { learnSpan: 1, deckSize: 0, learnLimit: 0 })
    // Force an empty span by trimming the arrays ourselves is not needed: learnSpan must
    // be ≥ 1 to pass validation, so exercise the `mean([])` and `.at(-1) ?? 0` branches by
    // handing workloadSummary an actually-empty result shape directly.
    const empty = {
      memorizedCntPerDay: [],
      reviewCntPerDay: [],
      learnCntPerDay: [],
      costPerDay: [],
      correctCntPerDay: [],
      introducedCntPerDay: [],
    }
    const summary = workloadSummary(empty)
    expect(summary).toEqual({ reviewsPerDay: 0, minutesPerDay: 0, memorized: 0, trueRetention: 0 })
    // A real span with zero cards to review also resolves to the same zeros.
    expect(workloadSummary(result)).toEqual({
      reviewsPerDay: 0,
      minutesPerDay: 0,
      memorized: 0,
      trueRetention: 0,
    })
  })
})

describe('§7 — relativeWorkload', () => {
  it('is > 1 going up in retention and < 1 going down', () => {
    const config = { deckSize: 2000, learnSpan: 365 }
    expect(relativeWorkload(0.9, 0.95, DEFAULT_FSRS_W, config)).toBeGreaterThan(1)
    expect(relativeWorkload(0.9, 0.8, DEFAULT_FSRS_W, config)).toBeLessThan(1)
  })

  it('returns 1 when both baseline and target schedule no reviews', () => {
    const config = { learnLimit: 0, deckSize: 0 }
    expect(relativeWorkload(0.9, 0.95, DEFAULT_FSRS_W, config)).toBe(1)
  })

  it('returns Infinity when only the baseline schedules no reviews', () => {
    // A single card, on the default seed: at DR 0.70 its first interval overshoots a
    // 5-day span (no second review ever happens), while at 0.86 it does not — measured,
    // not derived, so pin the exact config that produces the split.
    const config = {
      deckSize: 1,
      learnLimit: 1,
      learnSpan: 5,
      reviewLimit: 1000,
      maxCostPerday: 100_000,
    }
    const baseline = workloadSummary(simulate(DEFAULT_FSRS_W, 0.7, config)).reviewsPerDay
    const target = workloadSummary(simulate(DEFAULT_FSRS_W, 0.86, config)).reviewsPerDay
    expect(baseline).toBe(0)
    expect(target).toBeGreaterThan(0)
    expect(relativeWorkload(0.7, 0.86, DEFAULT_FSRS_W, config)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('§6 — ratingProbabilitiesFrom', () => {
  it('returns null when either sample is below RATING_PROBABILITY_MIN_SAMPLE', () => {
    const events = Array.from({ length: RATING_PROBABILITY_MIN_SAMPLE - 1 }, () => ({
      rating: 3,
      state: 0,
    }))
    expect(ratingProbabilitiesFrom(events)).toBeNull()
  })

  it('returns null when the review sample alone is short, even with plenty of first answers', () => {
    const first = Array.from({ length: RATING_PROBABILITY_MIN_SAMPLE }, () => ({
      rating: 3,
      state: 0,
    }))
    const review = Array.from({ length: RATING_PROBABILITY_MIN_SAMPLE - 1 }, () => ({
      rating: 3,
      state: 2,
    }))
    expect(ratingProbabilitiesFrom([...first, ...review])).toBeNull()
  })

  it('ignores rating 0 and out-of-range ratings', () => {
    const base = Array.from({ length: RATING_PROBABILITY_MIN_SAMPLE }, () => ({
      rating: 3,
      state: 0,
    }))
    const review = Array.from({ length: RATING_PROBABILITY_MIN_SAMPLE }, () => ({
      rating: 3,
      state: 2,
    }))
    const noise = [
      { rating: 0, state: 0 },
      { rating: 5, state: 0 },
      { rating: -1, state: 2 },
    ]
    const result = ratingProbabilitiesFrom([...base, ...review, ...noise])
    expect(result).not.toBeNull()
    // The noise did not shift the vectors: 100% Good.
    expect(result?.firstRatingProb).toEqual([0, 0, 1, 0])
    expect(result?.reviewRatingProb).toEqual([0, 1, 0])
  })

  it('buckets state 0/1 into firstRatingProb and 2/3 into reviewRatingProb', () => {
    const learning = Array.from({ length: RATING_PROBABILITY_MIN_SAMPLE }, (_, i) => ({
      rating: 3,
      state: i % 2, // alternates New (0) and Learning (1)
    }))
    const review = Array.from({ length: RATING_PROBABILITY_MIN_SAMPLE }, (_, i) => ({
      rating: 3,
      state: 2 + (i % 2), // alternates Review (2) and Relearning (3)
    }))
    const result = ratingProbabilitiesFrom([...learning, ...review])
    expect(result?.firstRatingProb).toEqual([0, 0, 1, 0])
    expect(result?.reviewRatingProb).toEqual([0, 1, 0])
  })

  it('excludes a review-state Again from reviewRatingProb (conditioned on recall)', () => {
    const first = Array.from({ length: RATING_PROBABILITY_MIN_SAMPLE }, () => ({
      rating: 3,
      state: 0,
    }))
    const goodReviews = Array.from({ length: RATING_PROBABILITY_MIN_SAMPLE }, () => ({
      rating: 3,
      state: 2,
    }))
    const againReviews = Array.from({ length: 50 }, () => ({ rating: 1, state: 2 }))
    const result = ratingProbabilitiesFrom([...first, ...goodReviews, ...againReviews])
    // Again (rating 1) on a Review card is dropped: reviewRatingProb still sums to 1 over
    // Hard/Good/Easy only, unaffected by the 50 Again rows.
    expect(result?.reviewRatingProb).toEqual([0, 1, 0])
  })

  it('both vectors sum to 1 on a mixed sample', () => {
    const ratings = [1, 2, 3, 4]
    const first = ratings.flatMap((rating) =>
      Array.from({ length: RATING_PROBABILITY_MIN_SAMPLE }, () => ({ rating, state: 0 })),
    )
    const review = [2, 3, 4].flatMap((rating) =>
      Array.from({ length: RATING_PROBABILITY_MIN_SAMPLE }, () => ({ rating, state: 2 })),
    )
    const result = ratingProbabilitiesFrom([...first, ...review])
    expect(result).not.toBeNull()
    const firstSum = (result?.firstRatingProb ?? []).reduce((a, b) => a + b, 0)
    const reviewSum = (result?.reviewRatingProb ?? []).reduce((a, b) => a + b, 0)
    expect(firstSum).toBeCloseTo(1, 10)
    expect(reviewSum).toBeCloseTo(1, 10)
  })
})

describe('DEFAULT_SIMULATOR_CONFIG', () => {
  it('matches the documented shape of a healthy collection', () => {
    expect(DEFAULT_SIMULATOR_CONFIG.deckSize).toBe(10_000)
    expect(DEFAULT_SIMULATOR_CONFIG.learnSpan).toBe(365)
    expect(DEFAULT_SIMULATOR_CONFIG.suspendAfterLapses).toBe(8)
    expect(DEFAULT_SIMULATOR_CONFIG.newCardsIgnoreReviewLimit).toBe(false)
  })
})
