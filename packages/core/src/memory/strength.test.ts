import { describe, expect, it } from 'vitest'
import { cardFixture } from '../testing/memory-fixtures'
import { forgettingCurve } from './formulas'
import { createFsrsScheduler } from './fsrs-scheduler'
import { retrievabilityNow, STRENGTH_BANDS, strengthBand, strengthLabel } from './strength'
import { DAY_MS } from './study-day'
import { CARD_STATE } from './types'

const LAST_REVIEW = new Date('2026-01-05T08:00:00.000Z')

/** A `Review` card last seen at `LAST_REVIEW`, with the given stability. */
function reviewed(stability: number) {
  return cardFixture({
    state: CARD_STATE.Review,
    stability,
    difficulty: 5,
    reps: 3,
    scheduledDays: Math.round(stability),
    lastReview: LAST_REVIEW,
  })
}

const daysLater = (days: number) => new Date(LAST_REVIEW.getTime() + days * DAY_MS)

describe('retrievabilityNow', () => {
  it('is exactly 0.9 one stability after the last review — the definition of S', () => {
    expect(retrievabilityNow(reviewed(30), daysLater(30))).toBeCloseTo(0.9, 10)
  })

  it('agrees with the forgetting curve it is built on', () => {
    expect(retrievabilityNow(reviewed(30), daysLater(7))).toBeCloseTo(forgettingCurve(7, 30), 12)
  })

  it('agrees with the scheduler’s own answer', () => {
    const card = reviewed(30)
    const at = daysLater(11)
    expect(retrievabilityNow(card, at)).toBeCloseTo(
      createFsrsScheduler().retrievability(card, at),
      6,
    )
  })

  it('decays monotonically', () => {
    const card = reviewed(30)
    const series = [0, 5, 15, 45, 200].map((days) => retrievabilityNow(card, daysLater(days)))
    expect(series).toEqual([...series].sort((a, b) => b - a))
    expect(series[0]).toBe(1)
  })

  it('is 0 for a card with nothing to retrieve yet', () => {
    expect(retrievabilityNow(cardFixture(), daysLater(1))).toBe(0)
    expect(retrievabilityNow(reviewed(0), daysLater(1))).toBe(0)
    expect(retrievabilityNow(cardFixture({ stability: 30, lastReview: null }), daysLater(1))).toBe(
      0,
    )
  })

  it('takes a custom decay and day boundary', () => {
    const card = reviewed(30)
    expect(retrievabilityNow(card, daysLater(30), { w20: 0.3 })).toBeCloseTo(0.9, 10)
    expect(
      retrievabilityNow(card, daysLater(30), {
        dayBoundary: { timeZone: 'America/Argentina/Buenos_Aires', dayStartHour: 0 },
      }),
    ).toBeCloseTo(0.9, 10)
  })
})

describe('strengthBand', () => {
  /** The same four bands `packages/ui`'s `MemoryStrengthBar` paints. */
  it('exposes the cut-offs the UI colours by', () => {
    expect(STRENGTH_BANDS.map((entry) => [entry.band, entry.max])).toEqual([
      ['critical', 0.3],
      ['weak', 0.6],
      ['good', 0.85],
      ['strong', Number.POSITIVE_INFINITY],
    ])
  })

  it.each([
    [0, 'critical'],
    [0.3, 'critical'],
    [0.3001, 'weak'],
    [0.6, 'weak'],
    [0.61, 'good'],
    [0.85, 'good'],
    [0.851, 'strong'],
    [1, 'strong'],
  ] as const)('puts R = %s in the %s band', (r, band) => {
    expect(strengthBand(r)).toBe(band)
  })

  it('clamps anything outside [0, 1] rather than throwing', () => {
    expect(strengthBand(-1)).toBe('critical')
    expect(strengthBand(2)).toBe('strong')
    expect(strengthBand(Number.NaN)).toBe('critical')
  })
})

describe('strengthLabel', () => {
  it('gives the numbers behind "~82 % hoy", never the sentence', () => {
    const card = reviewed(30)
    // FSRS-6's curve is a power law, not an exponential: R only reaches 0.82 eighty days
    // after a 30-day stability, which is why an item can sit well past its interval and
    // still be worth showing as "~82 %".
    expect(strengthLabel(card, daysLater(80))).toEqual({
      percent: 82,
      band: 'good',
      known: true,
    })
  })

  it('rounds to whole percentage points', () => {
    expect(strengthLabel(reviewed(30), daysLater(30)).percent).toBe(90)
    expect(strengthLabel(reviewed(30), daysLater(0)).percent).toBe(100)
  })

  it('says it has no data rather than claiming 0 % for a new card', () => {
    expect(strengthLabel(cardFixture(), daysLater(1))).toEqual({
      percent: 0,
      band: 'critical',
      known: false,
    })
  })
})
