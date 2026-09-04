import { describe, expect, it } from 'vitest'
import { easyDayLevelAt, resolveEasyDayCalendar } from './easy-days'
import { resolveDayBoundary } from './study-day'

const UTC = resolveDayBoundary()

describe('§4 — easyDayLevelAt', () => {
  it('is "normal" when nothing is configured for the day', () => {
    const at = new Date('2026-01-05T12:00:00.000Z') // a Monday
    expect(easyDayLevelAt(at, {}, UTC)).toBe('normal')
  })

  it('applies a weekday entry', () => {
    const monday = new Date('2026-01-05T12:00:00.000Z')
    expect(easyDayLevelAt(monday, { easyDays: { 1: 'reduced' } }, UTC)).toBe('reduced')
  })

  it('applies a specific date entry', () => {
    const at = new Date('2026-01-05T12:00:00.000Z')
    expect(easyDayLevelAt(at, { easyDates: { '2026-01-05': 'minimum' } }, UTC)).toBe('minimum')
  })

  it("a date's level beats its weekday's when both are configured for the same day", () => {
    const monday = new Date('2026-01-05T12:00:00.000Z')
    const input = {
      easyDays: { 1: 'reduced' as const },
      easyDates: { '2026-01-05': 'minimum' as const },
    }
    expect(easyDayLevelAt(monday, input, UTC)).toBe('minimum')
  })

  it('the dayStartHour boundary matters: 02:00 belongs to the previous study day', () => {
    const boundary = resolveDayBoundary({ dayStartHour: 4 })
    // 2026-01-05 is a Monday; 02:00 that day, with a 4 a.m. rollover, is still Sunday's
    // study day (2026-01-04).
    const at = new Date('2026-01-05T02:00:00.000Z')
    const input = {
      easyDays: { 0: 'minimum' as const, 1: 'reduced' as const }, // Sunday vs Monday
    }
    expect(easyDayLevelAt(at, input, boundary)).toBe('minimum')
  })

  it('honours a non-UTC time zone', () => {
    const boundary = resolveDayBoundary({
      dayStartHour: 4,
      timeZone: 'America/Argentina/Buenos_Aires',
    })
    // 2026-01-05T06:30Z is 03:30 local — still Sunday's (2026-01-04) study day, one hour
    // before the 4 a.m. local rollover.
    const at = new Date('2026-01-05T06:30:00.000Z')
    const input = { easyDates: { '2026-01-04': 'minimum' as const } }
    expect(easyDayLevelAt(at, input, boundary)).toBe('minimum')
  })
})

describe('§4 — resolveEasyDayCalendar', () => {
  it('isEmpty is true only when both maps are empty or absent', () => {
    expect(resolveEasyDayCalendar({}).isEmpty).toBe(true)
    expect(resolveEasyDayCalendar({ easyDays: {}, easyDates: {} }).isEmpty).toBe(true)
  })

  it('isEmpty is false when easyDays has an entry', () => {
    expect(resolveEasyDayCalendar({ easyDays: { 1: 'reduced' } }).isEmpty).toBe(false)
  })

  it('isEmpty is false when easyDates has an entry', () => {
    expect(resolveEasyDayCalendar({ easyDates: { '2026-01-05': 'minimum' } }).isEmpty).toBe(false)
  })

  it('levelFor resolves a day the same way easyDayLevelAt does, with one bound boundary', () => {
    const calendar = resolveEasyDayCalendar({ easyDays: { 1: 'reduced' } }, { dayStartHour: 4 })
    const monday = new Date('2026-01-05T12:00:00.000Z')
    expect(calendar.levelFor(monday)).toBe('reduced')
  })
})
