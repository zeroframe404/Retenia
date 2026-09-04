import { type DayBoundary, resolveDayBoundary, studyDay, studyWeekday } from './study-day'
import type { EasyDates, EasyDayLevel, EasyDays } from './types'

/**
 * "Easy days" (`docs/spec/02-memory-system.md` §4): per weekday, and per specific date, how
 * much reviewing the user is willing to take on.
 *
 * The scheduler applies this *after* the interval, inside the fuzz window, exactly as Anki
 * does — it never shortens or lengthens an interval, it only prefers one day of the window
 * over another. A level therefore costs the user nothing in retention; it moves a review by
 * a day or two at most.
 */

export interface EasyDayCalendar {
  /** The level in force on the study day `at` falls on. */
  levelFor(at: Date): EasyDayLevel
  /** True when nothing is configured, so the caller can skip the whole pass. */
  readonly isEmpty: boolean
}

export interface EasyDayInput {
  easyDays?: EasyDays | undefined
  easyDates?: EasyDates | undefined
}

/**
 * The level for one instant: a specific date's entry beats its weekday's, and anything
 * unconfigured is `normal`.
 *
 * Dates win because they are the more specific statement. "Reduced on Wednesdays, but I am
 * away on the 14th" has one sensible reading, and the reverse — a weekday rule quietly
 * overriding a date the user picked by hand — has none.
 */
export function easyDayLevelAt(at: Date, input: EasyDayInput, boundary: DayBoundary): EasyDayLevel {
  const { dayStartHour, timeZone } = boundary
  const onDate = input.easyDates?.[studyDay(at, dayStartHour, timeZone)]
  if (onDate !== undefined) return onDate
  return input.easyDays?.[studyWeekday(at, dayStartHour, timeZone)] ?? 'normal'
}

/** A calendar bound to one boundary, so the scheduler resolves a day with one call. */
export function resolveEasyDayCalendar(
  input: EasyDayInput,
  boundary: Partial<DayBoundary> = {},
): EasyDayCalendar {
  const resolved = resolveDayBoundary(boundary)
  const weekdayCount = Object.keys(input.easyDays ?? {}).length
  const dateCount = Object.keys(input.easyDates ?? {}).length
  return {
    levelFor: (at) => easyDayLevelAt(at, input, resolved),
    isEmpty: weekdayCount === 0 && dateCount === 0,
  }
}
