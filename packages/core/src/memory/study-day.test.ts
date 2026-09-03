import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_TIME_ZONE,
  isSameStudyDay,
  isValidTimeZone,
  resolveDayBoundary,
  studyDay,
  studyDayNumber,
  studyDaysBetween,
  studyWeekday,
  timeZoneOffsetMs,
} from './study-day'

const BA = 'America/Argentina/Buenos_Aires' // UTC−3, no DST
const NY = 'America/New_York' // UTC−5 / UTC−4

describe('studyDay', () => {
  it('rolls over at the day-start hour, 4 a.m. by default', () => {
    expect(DEFAULT_DAY_START_HOUR).toBe(4)
    expect(DEFAULT_TIME_ZONE).toBe('UTC')
    expect(studyDay(new Date('2026-01-05T03:59:59.999Z'))).toBe('2026-01-04')
    expect(studyDay(new Date('2026-01-05T04:00:00.000Z'))).toBe('2026-01-05')
    expect(studyDay(new Date('2026-01-05T23:30:00.000Z'))).toBe('2026-01-05')
    expect(studyDay(new Date('2026-01-05T01:00:00.000Z'), 0)).toBe('2026-01-05')
    expect(studyDay(new Date('2026-01-05T22:00:00.000Z'), 23)).toBe('2026-01-04')
  })

  it('uses the user’s zone: 3:30 a.m. in Buenos Aires is still yesterday', () => {
    expect(studyDay(new Date('2026-01-05T06:30:00Z'), 4, BA)).toBe('2026-01-04')
    expect(studyDay(new Date('2026-01-05T07:00:00Z'), 4, BA)).toBe('2026-01-05')
    // Midnight in Buenos Aires is 03:00 UTC: with hour 0 the local date decides.
    expect(studyDay(new Date('2026-01-05T02:59:59Z'), 0, BA)).toBe('2026-01-04')
    expect(studyDay(new Date('2026-01-05T03:00:00Z'), 0, BA)).toBe('2026-01-05')
  })

  it('follows daylight-saving changes', () => {
    // New York springs forward on 2026-03-08 at 02:00 local (07:00 UTC).
    expect(timeZoneOffsetMs(new Date('2026-03-08T06:59:00Z'), NY)).toBe(-5 * 3_600_000)
    expect(timeZoneOffsetMs(new Date('2026-03-08T07:00:00Z'), NY)).toBe(-4 * 3_600_000)
    expect(studyDay(new Date('2026-03-08T07:30:00Z'), 4, NY)).toBe('2026-03-07')
    expect(studyDay(new Date('2026-03-08T08:00:00Z'), 4, NY)).toBe('2026-03-08')
    expect(timeZoneOffsetMs(new Date('2026-01-05T12:00:00Z'), BA)).toBe(-3 * 3_600_000)
    expect(timeZoneOffsetMs(new Date('2026-01-05T12:00:00Z'), 'UTC')).toBe(0)
  })

  it('caches offsets per zone and minute, and survives the cache filling up', () => {
    const base = Date.UTC(2020, 0, 1)
    for (let minute = 0; minute < 8200; minute++) {
      expect(timeZoneOffsetMs(new Date(base + minute * 60_000), BA)).toBe(-3 * 3_600_000)
    }
    // Sub-second precision: the offset ignores the milliseconds of the instant.
    expect(timeZoneOffsetMs(new Date(base + 999), BA)).toBe(-3 * 3_600_000)
  })

  it('counts days and weekdays on study days', () => {
    const monday = new Date('2026-01-05T12:00:00Z')
    expect(studyWeekday(monday)).toBe(1)
    expect(studyWeekday(new Date('2026-01-05T02:00:00Z'))).toBe(0)
    expect(studyWeekday(new Date('1969-12-31T12:00:00Z'), 0)).toBe(3)
    expect(studyDaysBetween(monday, new Date('2026-01-08T03:00:00Z'))).toBe(2)
    expect(studyDaysBetween(monday, new Date('2026-01-08T04:00:00Z'))).toBe(3)
    expect(studyDaysBetween(monday, new Date('2026-01-01T12:00:00Z'))).toBe(-4)
    expect(isSameStudyDay(monday, new Date('2026-01-06T03:59:00Z'))).toBe(true)
    expect(isSameStudyDay(monday, new Date('2026-01-06T04:00:00Z'))).toBe(false)
    expect(studyDayNumber(new Date('1970-01-01T04:00:00Z'))).toBe(0)
    expect(studyDayNumber(new Date('1970-01-01T03:59:59Z'))).toBe(-1)
    expect(studyDayNumber(new Date(17 * DAY_MS), 0)).toBe(17)
  })

  it('validates its inputs', () => {
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone(BA)).toBe(true)
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
    expect(isValidTimeZone(42 as unknown as string)).toBe(false)
    expect(resolveDayBoundary()).toEqual({ dayStartHour: 4, timeZone: 'UTC' })
    expect(resolveDayBoundary({ dayStartHour: 0, timeZone: BA })).toEqual({
      dayStartHour: 0,
      timeZone: BA,
    })
    expect(() => resolveDayBoundary({ dayStartHour: 24 })).toThrow(RangeError)
    expect(() => resolveDayBoundary({ dayStartHour: 1.5 })).toThrow(RangeError)
    expect(() => resolveDayBoundary({ timeZone: 'Nowhere/Land' })).toThrow(RangeError)
    expect(() => studyDay(new Date(Number.NaN))).toThrow(TypeError)
    expect(() => timeZoneOffsetMs('2026-01-05' as unknown as Date, BA)).toThrow(TypeError)
  })
})
