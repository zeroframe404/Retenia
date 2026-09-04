import { describe, expect, it } from 'vitest'
import {
  buildDueHistogram,
  createLoadBalancer,
  dueAfterDays,
  LOAD_BALANCE_HORIZON_DAYS,
} from './load-balance'
import { DAY_MS } from './study-day'

const now = new Date('2026-01-10T12:00:00.000Z') // a study day boundary is 04:00 UTC

describe('§3.2 (i), §15 — buildDueHistogram', () => {
  it('countAt returns the number of cards due on each offset', () => {
    const due = [
      { due: dueAfterDays(now, 0) },
      { due: dueAfterDays(now, 0) },
      { due: dueAfterDays(now, 1) },
    ]
    const histogram = buildDueHistogram(due, { now })
    expect(histogram.countAt(0)).toBe(2)
    expect(histogram.countAt(1)).toBe(1)
    expect(histogram.countAt(2)).toBe(0)
  })

  it('collapses overdue cards onto offset 0', () => {
    const overdue = { due: new Date('2026-01-01T04:00:00.000Z') }
    const histogram = buildDueHistogram([overdue], { now })
    expect(histogram.countAt(0)).toBe(1)
  })

  it('does not count a card beyond horizonDays', () => {
    const beyond = { due: dueAfterDays(now, 10) }
    const histogram = buildDueHistogram([beyond], { now, horizonDays: 5 })
    expect(histogram.countAt(10)).toBe(0)
    expect(histogram.countAt(5)).toBe(0)
  })

  it('exposes anchorDay and horizonDays', () => {
    const histogram = buildDueHistogram([], { now, horizonDays: 30 })
    expect(histogram.horizonDays).toBe(30)
    expect(typeof histogram.anchorDay).toBe('number')
  })

  it('defaults horizonDays to LOAD_BALANCE_HORIZON_DAYS', () => {
    const histogram = buildDueHistogram([], { now })
    expect(histogram.horizonDays).toBe(LOAD_BALANCE_HORIZON_DAYS)
    expect(LOAD_BALANCE_HORIZON_DAYS).toBe(365)
  })

  it('note adds and unnote removes', () => {
    const histogram = buildDueHistogram([], { now })
    const day = dueAfterDays(now, 3)
    histogram.note(day)
    expect(histogram.countAt(3)).toBe(1)
    histogram.note(day)
    expect(histogram.countAt(3)).toBe(2)
    histogram.unnote(day)
    expect(histogram.countAt(3)).toBe(1)
  })

  it('unnote past zero deletes rather than going negative', () => {
    const histogram = buildDueHistogram([], { now })
    const day = dueAfterDays(now, 3)
    histogram.unnote(day)
    expect(histogram.countAt(3)).toBe(0)
    // A subsequent note starts fresh from 0, not from -1.
    histogram.note(day)
    expect(histogram.countAt(3)).toBe(1)
  })

  it('a note beyond the horizon is not recorded', () => {
    const histogram = buildDueHistogram([], { now, horizonDays: 5 })
    histogram.note(dueAfterDays(now, 10))
    expect(histogram.countAt(10)).toBe(0)
  })
})

describe('§15 — createLoadBalancer', () => {
  it('picks the candidate day with the fewest due cards', () => {
    const due = [
      { due: dueAfterDays(now, 0) },
      { due: dueAfterDays(now, 0) },
      { due: dueAfterDays(now, 1) },
    ]
    const histogram = buildDueHistogram(due, { now })
    const balancer = createLoadBalancer(histogram, { now })
    const candidates = [dueAfterDays(now, 0), dueAfterDays(now, 1), dueAfterDays(now, 2)]
    expect(balancer(candidates).getTime()).toBe(candidates[2]?.getTime())
  })

  it('is pure: repeated calls return the same day and never mutate the histogram', () => {
    const histogram = buildDueHistogram([], { now })
    const balancer = createLoadBalancer(histogram, { now })
    const candidates = [dueAfterDays(now, 0), dueAfterDays(now, 1)]
    const first = balancer(candidates)
    const countsBefore = [histogram.countAt(0), histogram.countAt(1)]
    const second = balancer(candidates)
    const third = balancer(candidates)
    const countsAfter = [histogram.countAt(0), histogram.countAt(1)]
    expect(first.getTime()).toBe(second.getTime())
    expect(second.getTime()).toBe(third.getTime())
    // No phantom increments: the counts the balancer read are exactly what it left behind.
    expect(countsAfter).toEqual(countsBefore)
    expect(countsAfter).toEqual([0, 0])
  })

  it('breaks ties toward the first candidate', () => {
    const histogram = buildDueHistogram([], { now })
    const balancer = createLoadBalancer(histogram, { now })
    const candidates = [dueAfterDays(now, 2), dueAfterDays(now, 1)]
    expect(balancer(candidates).getTime()).toBe(candidates[0]?.getTime())
  })

  it('returns the first candidate for an empty histogram', () => {
    const histogram = buildDueHistogram([], { now })
    const balancer = createLoadBalancer(histogram, { now })
    const candidates = [dueAfterDays(now, 5), dueAfterDays(now, 9)]
    expect(balancer(candidates).getTime()).toBe(candidates[0]?.getTime())
  })

  it('days past the horizon count as 0, so a far-future candidate can beat a crowded near one', () => {
    const crowded = dueAfterDays(now, 1)
    const due = Array.from({ length: 100 }, () => ({ due: crowded }))
    const histogram = buildDueHistogram(due, { now, horizonDays: 10 })
    const balancer = createLoadBalancer(histogram, { now })
    const farFuture = dueAfterDays(now, 400) // beyond the 10-day horizon
    const candidates = [crowded, farFuture]
    expect(balancer(candidates).getTime()).toBe(farFuture.getTime())
  })
})

describe('dueAfterDays', () => {
  it('adds whole days to the instant', () => {
    expect(dueAfterDays(now, 3).getTime()).toBe(now.getTime() + 3 * DAY_MS)
    expect(dueAfterDays(now, 0).getTime()).toBe(now.getTime())
  })
})
