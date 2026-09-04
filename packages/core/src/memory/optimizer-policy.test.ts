import { describe, expect, it } from 'vitest'
import {
  healthCheck,
  nextOptimizationThreshold,
  OPTIMIZER_CADENCE_BASE,
  OPTIMIZER_MAX_AGE_MS,
  OPTIMIZER_MIN_REVIEWS,
  optimizationOffer,
} from './optimizer-policy'

describe('§16 — nextOptimizationThreshold', () => {
  it('finds the next power-of-two cadence strictly above trainedOnReviews', () => {
    expect(nextOptimizationThreshold(0)).toBe(512)
    expect(nextOptimizationThreshold(512)).toBe(1024)
    expect(nextOptimizationThreshold(1023)).toBe(1024)
    expect(nextOptimizationThreshold(1024)).toBe(2048)
  })

  it('matches OPTIMIZER_CADENCE_BASE at 0', () => {
    expect(nextOptimizationThreshold(0)).toBe(OPTIMIZER_CADENCE_BASE)
  })
})

describe('§16 — optimizationOffer', () => {
  const now = new Date('2026-06-01T00:00:00.000Z')

  it('never offers below OPTIMIZER_MIN_REVIEWS', () => {
    const offer = optimizationOffer({ nReviews: OPTIMIZER_MIN_REVIEWS - 1, profile: null, now })
    expect(offer).toEqual({ offered: false, reason: null, nextThresholdReviews: 512 })
  })

  it('offers "first" for a null profile once there is enough history', () => {
    const offer = optimizationOffer({ nReviews: OPTIMIZER_MIN_REVIEWS, profile: null, now })
    expect(offer.offered).toBe(true)
    expect(offer.reason).toBe('first')
    expect(offer.nextThresholdReviews).toBe(512)
  })

  it('offers "reviews" once the count crosses the next 2^n threshold', () => {
    const trainedAt = new Date('2026-05-25T00:00:00.000Z') // recent, not a month old
    const profile = { trainedAt, nReviews: 500 }
    const under = optimizationOffer({ nReviews: 511, profile, now })
    expect(under.offered).toBe(false)
    expect(under.nextThresholdReviews).toBe(512)

    const over = optimizationOffer({ nReviews: 512, profile, now })
    expect(over.offered).toBe(true)
    expect(over.reason).toBe('reviews')
    expect(over.nextThresholdReviews).toBe(512)
  })

  it('offers "monthly" once a month has passed since trainedAt, below the review threshold', () => {
    const trainedAt = new Date(now.getTime() - OPTIMIZER_MAX_AGE_MS)
    const profile = { trainedAt, nReviews: 500 }
    const offer = optimizationOffer({ nReviews: 501, profile, now })
    expect(offer.offered).toBe(true)
    expect(offer.reason).toBe('monthly')
    expect(offer.nextThresholdReviews).toBe(512)
  })

  it('does not offer for a recent run below the review threshold', () => {
    const trainedAt = new Date(now.getTime() - OPTIMIZER_MAX_AGE_MS + 1)
    const profile = { trainedAt, nReviews: 500 }
    const offer = optimizationOffer({ nReviews: 501, profile, now })
    expect(offer).toEqual({ offered: false, reason: null, nextThresholdReviews: 512 })
  })
})

describe('§16 — healthCheck', () => {
  it('accepts a strictly lower log loss as an improvement', () => {
    const result = healthCheck({ logLoss: 0.4, rmse: 0.08 }, { logLoss: 0.35, rmse: 0.07 })
    expect(result.improved).toBe(true)
    expect(result.reason).toBe('improved')
    expect(result.logLossDelta).toBeCloseTo(0.05, 10)
    expect(result.rmseDelta).toBeCloseTo(0.01, 10)
  })

  it('rejects an equal log loss — retraining on unchanged history must not "improve"', () => {
    const result = healthCheck({ logLoss: 0.35, rmse: 0.07 }, { logLoss: 0.35, rmse: 0.07 })
    expect(result.improved).toBe(false)
    expect(result.reason).toBe('log_loss_not_better')
    expect(result.logLossDelta).toBe(0)
  })

  it('rejects a higher (worse) log loss', () => {
    const result = healthCheck({ logLoss: 0.35, rmse: 0.07 }, { logLoss: 0.4, rmse: 0.05 })
    expect(result.improved).toBe(false)
    expect(result.reason).toBe('log_loss_not_better')
    expect(result.logLossDelta).toBeCloseTo(-0.05, 10)
  })

  it('a worse RMSE does not veto a genuine log-loss improvement', () => {
    const result = healthCheck({ logLoss: 0.4, rmse: 0.05 }, { logLoss: 0.35, rmse: 0.09 })
    expect(result.improved).toBe(true)
    expect(result.reason).toBe('improved')
    expect(result.rmseDelta).toBeLessThan(0)
  })
})
