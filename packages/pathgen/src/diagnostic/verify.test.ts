import { describe, expect, it } from 'vitest'
import { REOPEN_MEAN_R, REOPEN_WINDOW_DAYS, shouldReopen } from './verify'

const NOW = new Date('2026-09-11T00:00:00.000Z')
const DAY_MS = 86_400_000

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS)
}

describe('shouldReopen()', () => {
  it('reopens on exactly 2 lapses (Again, state Review) inside 14 days', () => {
    const verdict = shouldReopen({
      now: NOW,
      logs: [
        { rating: 1, state: 2, review: daysAgo(1) },
        { rating: 1, state: 2, review: daysAgo(5) },
      ],
      cards: [],
    })
    expect(verdict).toEqual({ reopen: true, reason: 'lapses', lapses: 2, meanR: null })
  })

  it('does not reopen on a single lapse', () => {
    const verdict = shouldReopen({
      now: NOW,
      logs: [{ rating: 1, state: 2, review: daysAgo(1) }],
      cards: [],
    })
    expect(verdict.reopen).toBe(false)
    expect(verdict.lapses).toBe(1)
  })

  it('does not count an Again during the learning state (state 1) as a lapse', () => {
    const verdict = shouldReopen({
      now: NOW,
      logs: [
        { rating: 1, state: 1, review: daysAgo(1) },
        { rating: 1, state: 1, review: daysAgo(2) },
      ],
      cards: [],
    })
    expect(verdict.lapses).toBe(0)
    expect(verdict.reopen).toBe(false)
  })

  it('counts a lapse exactly 14 days ago, but not one 14 days and 1ms ago', () => {
    expect(REOPEN_WINDOW_DAYS).toBe(14)
    const atEdge = shouldReopen({
      now: NOW,
      logs: [
        { rating: 1, state: 2, review: new Date(NOW.getTime() - 14 * DAY_MS) },
        { rating: 1, state: 2, review: daysAgo(1) },
      ],
      cards: [],
    })
    expect(atEdge.lapses).toBe(2)

    const pastEdge = shouldReopen({
      now: NOW,
      logs: [
        { rating: 1, state: 2, review: new Date(NOW.getTime() - 14 * DAY_MS - 1) },
        { rating: 1, state: 2, review: daysAgo(1) },
      ],
      cards: [],
    })
    expect(pastEdge.lapses).toBe(1)
    expect(pastEdge.reopen).toBe(false)
  })

  it('ignores a future-dated log', () => {
    const verdict = shouldReopen({
      now: NOW,
      logs: [
        { rating: 1, state: 2, review: new Date(NOW.getTime() + DAY_MS) },
        { rating: 1, state: 2, review: daysAgo(1) },
      ],
      cards: [],
    })
    expect(verdict.lapses).toBe(1)
    expect(verdict.reopen).toBe(false)
  })

  it('reopens for low retention: mean R < 0.7 over reviewed (non-New) cards', () => {
    expect(REOPEN_MEAN_R).toBe(0.7)
    const verdict = shouldReopen({
      now: NOW,
      logs: [],
      cards: [
        { state: 2, retrievability: 0.5 },
        { state: 2, retrievability: 0.6 },
      ],
    })
    expect(verdict).toEqual({ reopen: true, reason: 'low_retention', lapses: 0, meanR: 0.55 })
  })

  it('excludes New cards from the mean R', () => {
    const verdict = shouldReopen({
      now: NOW,
      logs: [],
      cards: [
        { state: 0, retrievability: 0.01 }, // New: would drag the mean below 0.7 if counted.
        { state: 2, retrievability: 0.9 },
      ],
    })
    expect(verdict.meanR).toBe(0.9)
    expect(verdict.reopen).toBe(false)
  })

  it('reports meanR null and does not reopen when no card has been reviewed', () => {
    const verdict = shouldReopen({
      now: NOW,
      logs: [],
      cards: [{ state: 0, retrievability: 0 }],
    })
    expect(verdict).toEqual({ reopen: false, reason: null, lapses: 0, meanR: null })
  })

  it('prefers the lapses reason when both the lapses and low-retention rules hold', () => {
    const verdict = shouldReopen({
      now: NOW,
      logs: [
        { rating: 1, state: 2, review: daysAgo(1) },
        { rating: 1, state: 2, review: daysAgo(2) },
      ],
      cards: [{ state: 2, retrievability: 0.3 }],
    })
    expect(verdict.reason).toBe('lapses')
  })

  it('does not reopen with a good mean R and no lapses', () => {
    const verdict = shouldReopen({
      now: NOW,
      logs: [],
      cards: [{ state: 2, retrievability: 0.95 }],
    })
    expect(verdict.reopen).toBe(false)
  })
})
