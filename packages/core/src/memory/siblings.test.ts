import { describe, expect, it } from 'vitest'
import { cardFixture } from '../testing/memory-fixtures'
import { disperseSiblingDueDates, MAX_SIBLING_SPREAD_DAYS, siblingBurialUntil } from './siblings'
import { DAY_MS } from './study-day'
import { CARD_STATE } from './types'

describe('§4 — siblingBurialUntil', () => {
  it('returns the start of the next study day, default 4 a.m.', () => {
    const now = new Date('2026-01-05T10:00:00.000Z')
    const until = siblingBurialUntil(now)
    expect(until.toISOString()).toBe('2026-01-06T04:00:00.000Z')
  })

  it('a review at 23:00 buries until the next 04:00 boundary, not 23:00 the next day', () => {
    const now = new Date('2026-01-05T23:00:00.000Z')
    const until = siblingBurialUntil(now)
    // 23:00 on the 5th is already inside the study day that started 04:00 on the 5th; the
    // *next* study day starts 04:00 on the 6th — 5 hours later, not 24.
    expect(until.toISOString()).toBe('2026-01-06T04:00:00.000Z')
    expect(until.getTime() - now.getTime()).toBe(5 * 60 * 60 * 1000)
  })

  it('honours a non-default dayStartHour', () => {
    const now = new Date('2026-01-05T10:00:00.000Z')
    const until = siblingBurialUntil(now, { dayStartHour: 0 })
    expect(until.toISOString()).toBe('2026-01-06T00:00:00.000Z')
  })

  it('honours a non-UTC time zone', () => {
    const now = new Date('2026-01-05T10:00:00.000Z') // 07:00 in Buenos Aires (UTC-3)
    const until = siblingBurialUntil(now, { timeZone: 'America/Argentina/Buenos_Aires' })
    // Next study day starts 04:00 local = 07:00 UTC, on the 6th.
    expect(until.toISOString()).toBe('2026-01-06T07:00:00.000Z')
  })
})

describe('§4 — disperseSiblingDueDates', () => {
  const now = new Date('2026-01-10T12:00:00.000Z')

  function reviewCard(overrides: Partial<Parameters<typeof cardFixture>[0]> = {}) {
    return cardFixture({
      state: CARD_STATE.Review,
      suspended: false,
      deletedAt: null,
      ...overrides,
    })
  }

  it('keeps the earliest-due card and pushes later same-day siblings to the next free day', () => {
    const due = new Date('2026-01-15T04:00:00.000Z')
    const cards = [
      reviewCard({ id: 'a', due }),
      reviewCard({ id: 'b', due }),
      reviewCard({ id: 'c', due }),
    ]
    const moves = disperseSiblingDueDates({ cards, now })
    expect(moves.find((m) => m.cardId === 'a')).toBeUndefined()
    const b = moves.find((m) => m.cardId === 'b')
    const c = moves.find((m) => m.cardId === 'c')
    expect(b?.to.getTime()).toBe(due.getTime() + DAY_MS)
    expect(c?.to.getTime()).toBe(due.getTime() + 2 * DAY_MS)
  })

  it('produces no moves for cards already on distinct days', () => {
    const cards = [
      reviewCard({ id: 'a', due: new Date('2026-01-15T04:00:00.000Z') }),
      reviewCard({ id: 'b', due: new Date('2026-01-16T04:00:00.000Z') }),
    ]
    expect(disperseSiblingDueDates({ cards, now })).toEqual([])
  })

  it('skips New/Learning/Relearning cards', () => {
    const due = new Date('2026-01-15T04:00:00.000Z')
    const cards = [
      reviewCard({ id: 'a', due }),
      cardFixture({ id: 'b', state: CARD_STATE.New, due, suspended: false, deletedAt: null }),
      cardFixture({ id: 'c', state: CARD_STATE.Learning, due, suspended: false, deletedAt: null }),
      cardFixture({
        id: 'd',
        state: CARD_STATE.Relearning,
        due,
        suspended: false,
        deletedAt: null,
      }),
    ]
    expect(disperseSiblingDueDates({ cards, now })).toEqual([])
  })

  it('skips suspended and soft-deleted cards', () => {
    const due = new Date('2026-01-15T04:00:00.000Z')
    const cards = [
      reviewCard({ id: 'a', due }),
      reviewCard({ id: 'b', due, suspended: true }),
      reviewCard({ id: 'c', due, deletedAt: new Date('2026-01-01T00:00:00.000Z') }),
    ]
    expect(disperseSiblingDueDates({ cards, now })).toEqual([])
  })

  it('disperses overdue cards from today, not from the day they were originally due', () => {
    const overdueDay = new Date('2026-01-01T04:00:00.000Z') // well before `now`
    const cards = [
      reviewCard({ id: 'a', due: overdueDay }),
      reviewCard({ id: 'b', due: overdueDay }),
    ]
    const moves = disperseSiblingDueDates({ cards, now })
    const todayStart = new Date('2026-01-10T04:00:00.000Z')
    // Both are overdue, so dispersal starts from `today`, not from `overdueDay`: `a`
    // (the earliest) lands on today itself, `b` on the day after — neither anywhere near
    // `overdueDay + 1 day`.
    const a = moves.find((m) => m.cardId === 'a')
    const b = moves.find((m) => m.cardId === 'b')
    expect(a?.to.getTime()).toBe(todayStart.getTime())
    expect(b?.to.getTime()).toBe(todayStart.getTime() + DAY_MS)
  })

  it('caps the push at maxSpreadDays: a card that cannot be pushed further stays where the cap left it', () => {
    const due = new Date('2026-01-15T04:00:00.000Z')
    // Four siblings all due the same day, but a spread cap of 2 days: the fourth cannot
    // be pushed past `due + 2 days`, so it lands there too, alongside the third.
    const cards = [
      reviewCard({ id: 'a', due }),
      reviewCard({ id: 'b', due }),
      reviewCard({ id: 'c', due }),
      reviewCard({ id: 'd', due }),
    ]
    const moves = disperseSiblingDueDates({ cards, now, maxSpreadDays: 2 })
    expect(moves.find((m) => m.cardId === 'a')).toBeUndefined()
    expect(moves.find((m) => m.cardId === 'b')?.to.getTime()).toBe(due.getTime() + DAY_MS)
    expect(moves.find((m) => m.cardId === 'c')?.to.getTime()).toBe(due.getTime() + 2 * DAY_MS)
    expect(moves.find((m) => m.cardId === 'd')?.to.getTime()).toBe(due.getTime() + 2 * DAY_MS)
  })

  it('breaks ties by card id when siblings share a due date', () => {
    const due = new Date('2026-01-15T04:00:00.000Z')
    const cards = [reviewCard({ id: 'z', due }), reviewCard({ id: 'a', due })]
    const moves = disperseSiblingDueDates({ cards, now })
    // 'a' sorts before 'z', so 'a' keeps the date and 'z' moves.
    expect(moves.find((m) => m.cardId === 'a')).toBeUndefined()
    expect(moves.find((m) => m.cardId === 'z')?.to.getTime()).toBe(due.getTime() + DAY_MS)
  })

  it('exposes MAX_SIBLING_SPREAD_DAYS as the default cap', () => {
    expect(MAX_SIBLING_SPREAD_DAYS).toBe(14)
  })
})
