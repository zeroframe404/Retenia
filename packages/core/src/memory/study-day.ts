import type { Weekday } from './types'

/**
 * Day boundaries (`docs/spec/02-memory-system.md` §14): timestamps are stored in UTC
 * milliseconds, and a "day" for the scheduler starts at `day_start_hour` (4 a.m. by
 * default, as in Anki and `fsrs-optimizer`) in the user's time zone — so a review at
 * 1 a.m. belongs to the evening before, and the same-day formulas of §3.2 (g) apply to it.
 *
 * `packages/core` has no Node: the time-zone arithmetic uses `Intl.DateTimeFormat`, which
 * is ECMAScript and available in every runtime the app targets.
 */

export const DAY_MS = 86_400_000
export const HOUR_MS = 3_600_000
export const DEFAULT_DAY_START_HOUR = 4
export const DEFAULT_TIME_ZONE = 'UTC'

export interface DayBoundary {
  /** `0…23`: the local hour a study day rolls over. */
  dayStartHour: number
  /** An IANA zone (`America/Argentina/Buenos_Aires`) or `UTC`. */
  timeZone: string
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (formatter === undefined) {
    // Throws a RangeError for a zone the runtime does not know.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/** True when the runtime knows `timeZone`. */
export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== 'string' || timeZone.length === 0) return false
  try {
    formatterFor(timeZone)
    return true
  } catch {
    return false
  }
}

/** Fills the defaults in and rejects an hour outside `0…23` or an unknown zone. */
export function resolveDayBoundary(options: Partial<DayBoundary> = {}): DayBoundary {
  const dayStartHour = options.dayStartHour ?? DEFAULT_DAY_START_HOUR
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE
  if (!Number.isInteger(dayStartHour) || dayStartHour < 0 || dayStartHour > 23) {
    throw new RangeError(`dayStartHour must be an integer hour 0…23, got ${String(dayStartHour)}`)
  }
  if (!isValidTimeZone(timeZone)) {
    throw new RangeError(`Unknown time zone "${String(timeZone)}"`)
  }
  return { dayStartHour, timeZone }
}

function assertDate(name: string, date: Date): number {
  const ms = date instanceof Date ? date.getTime() : Number.NaN
  if (!Number.isFinite(ms)) throw new TypeError(`${name} must be a valid Date`)
  return ms
}

/**
 * UTC offsets only change at minute boundaries (a DST switch is `2:00 → 3:00`), so one
 * lookup per zone and minute serves every timestamp inside it. Bounded so a reschedule of
 * a whole collection cannot grow it without limit.
 */
const offsetCache = new Map<string, number>()
const OFFSET_CACHE_LIMIT = 8192
const MINUTE_MS = 60_000

/** The zone's offset from UTC at `date`, in milliseconds (`local − UTC`; negative west). */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  return timeZoneOffsetAtMs(assertDate('date', date), timeZone)
}

/** `timeZoneOffsetMs` over a Unix-millisecond timestamp already known to be valid — the
 *  scheduler's hot path, which has no `Date` to spare. */
export function timeZoneOffsetAtMs(ms: number, timeZone: string): number {
  if (timeZone === DEFAULT_TIME_ZONE) return 0
  const key = `${timeZone}|${Math.floor(ms / MINUTE_MS)}`
  const cached = offsetCache.get(key)
  if (cached !== undefined) return cached

  const parts: Record<string, number> = {}
  for (const part of formatterFor(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  const asUtc = Date.UTC(
    parts.year as number,
    (parts.month as number) - 1,
    parts.day as number,
    parts.hour as number,
    parts.minute as number,
    parts.second as number,
  )
  // The formatter drops the milliseconds; compare whole seconds so the offset is exact.
  const offset = asUtc - Math.floor(ms / 1000) * 1000

  if (offsetCache.size >= OFFSET_CACHE_LIMIT) offsetCache.clear()
  offsetCache.set(key, offset)
  return offset
}

/**
 * The study day `date` falls on, as days since 1970-01-01: the calendar date, in the
 * user's zone, of the instant `dayStartHour` hours earlier. Two timestamps are "the same
 * day" for the scheduler exactly when this agrees.
 */
export function studyDayNumber(
  date: Date,
  dayStartHour: number = DEFAULT_DAY_START_HOUR,
  timeZone: string = DEFAULT_TIME_ZONE,
): number {
  const ms = assertDate('date', date)
  const boundary = resolveDayBoundary({ dayStartHour, timeZone })
  const shifted = ms + timeZoneOffsetMs(date, boundary.timeZone) - boundary.dayStartHour * HOUR_MS
  return Math.floor(shifted / DAY_MS)
}

/**
 * The instant the study day containing `date` began — `dayStartHour` local time, that
 * morning. The inverse of `studyDayNumber`, and what "everything reviewed today" and the
 * forecast's day buckets are measured from.
 *
 * The zone offset is resolved twice: once at the wall-clock guess and once at the instant
 * that produced, so a day starting inside a DST transition lands on the real boundary
 * rather than an hour either side of it.
 */
export function studyDayStart(
  date: Date,
  dayStartHour: number = DEFAULT_DAY_START_HOUR,
  timeZone: string = DEFAULT_TIME_ZONE,
): Date {
  const boundary = resolveDayBoundary({ dayStartHour, timeZone })
  const day = studyDayNumber(date, boundary.dayStartHour, boundary.timeZone)
  const wallClock = day * DAY_MS + boundary.dayStartHour * HOUR_MS
  const first = wallClock - timeZoneOffsetAtMs(wallClock, boundary.timeZone)
  return new Date(wallClock - timeZoneOffsetAtMs(first, boundary.timeZone))
}

/** The study day as ISO `YYYY-MM-DD` — what streaks and the heatmap key on. */
export function studyDay(
  date: Date,
  dayStartHour: number = DEFAULT_DAY_START_HOUR,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  return new Date(studyDayNumber(date, dayStartHour, timeZone) * DAY_MS).toISOString().slice(0, 10)
}

/** Whole study days from `from` to `to` — the scheduler's `elapsed_days`. Negative when
 *  `to` is earlier. */
export function studyDaysBetween(
  from: Date,
  to: Date,
  dayStartHour: number = DEFAULT_DAY_START_HOUR,
  timeZone: string = DEFAULT_TIME_ZONE,
): number {
  return studyDayNumber(to, dayStartHour, timeZone) - studyDayNumber(from, dayStartHour, timeZone)
}

export function isSameStudyDay(
  a: Date,
  b: Date,
  dayStartHour: number = DEFAULT_DAY_START_HOUR,
  timeZone: string = DEFAULT_TIME_ZONE,
): boolean {
  return studyDaysBetween(a, b, dayStartHour, timeZone) === 0
}

/** The weekday (0 = Sunday) of the study day `date` falls on — what easy days key on. */
export function studyWeekday(
  date: Date,
  dayStartHour: number = DEFAULT_DAY_START_HOUR,
  timeZone: string = DEFAULT_TIME_ZONE,
): Weekday {
  // 1970-01-01 was a Thursday (4).
  const day = studyDayNumber(date, dayStartHour, timeZone) + 4
  return (((day % 7) + 7) % 7) as Weekday
}
