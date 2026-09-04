import type { ImportanceLevel } from '../entities'
import type { CardRepository } from '../ports/card-repository'
import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import type { ReviewLogRepository } from '../ports/review-log-repository'
import type { SettingsRepository } from '../ports/settings-repository'
import { DEFAULT_IMPORTANCE_CATALOG, type ImportanceCatalog } from './importance'
import { FALLBACK_MEDIAN_SECONDS } from './session'
import { readSessionSettings } from './session-service'
import {
  DAY_MS,
  type DayBoundary,
  resolveDayBoundary,
  studyDay,
  studyDayNumber,
  studyDayStart,
} from './study-day'
import { CARD_STATE } from './types'

/**
 * The review forecast — `docs/spec/02-memory-system.md` §13, "Forecast": *"Cards and minutes
 * per day at 30/90 days, per level, with and without new."*
 *
 * What it is **not**: the workload simulation of §6, which projects a year of reviews under
 * a given desired retention and needs `fsrs-rs`'s simulator. This one only counts what is
 * already scheduled. The "with new" figures therefore add the introductions the quota allows
 * but *not* the follow-on reviews those introductions will generate — modelling that is the
 * simulator's job (sub-phase 4.6), and pretending otherwise here would understate a real
 * forecast's most useful number by a wide margin.
 */

/** A quarter is the longest window §13 asks for; the ceiling keeps one call bounded. */
export const FORECAST_MAX_DAYS = 365
export const FORECAST_MAX_CARDS = 50_000

export interface ForecastDay {
  /** ISO `YYYY-MM-DD` of the study day. */
  day: string
  /** Days from today; `0` is today. */
  offset: number
  byLevel: Readonly<Record<ImportanceLevel, number>>
  /** Reviews already scheduled for the day. */
  cards: number
  minutes: number
  /** New cards the quota would introduce that day. */
  newCards: number
  cardsWithNew: number
  minutesWithNew: number
}

export interface Forecast {
  days: readonly ForecastDay[]
  medianSecondsPerCard: number
  /** Cards already overdue when the forecast was taken. They are counted into day 0, which
   *  is what makes today's number match what the session actually offers. */
  backlog: number
  /** New cards still waiting to be introduced. */
  newPool: number
  dailyNewLimit: number
  generatedAt: Date
}

export interface ForecastRepositories {
  cards: Pick<CardRepository, 'listDueBetween'>
  reviewLogs: Pick<ReviewLogRepository, 'medianDurationMs'>
  settings: Pick<SettingsRepository, 'get'>
}

export interface ForecastDeps {
  repos: ForecastRepositories
  catalog?: ImportanceCatalog
  clock?: Clock
  dayBoundary?: Partial<DayBoundary>
}

export type ForecastQuery = (days: number, now?: Date) => Promise<Forecast>

function zeroCounts(catalog: ImportanceCatalog): Record<ImportanceLevel, number> {
  const counts = {} as Record<ImportanceLevel, number>
  for (const level of catalog.ordered()) counts[level.level] = 0
  return counts
}

export function createForecast(deps: ForecastDeps): ForecastQuery {
  const catalog = deps.catalog ?? DEFAULT_IMPORTANCE_CATALOG
  const clock = deps.clock ?? systemClock
  const boundary = resolveDayBoundary(deps.dayBoundary)

  return async (days, at) => {
    if (!Number.isFinite(days) || days < 1) {
      throw new RangeError(`forecast: days must be at least 1, got ${String(days)}`)
    }
    const span = Math.min(FORECAST_MAX_DAYS, Math.floor(days))
    const now = at ?? clock.now()
    const start = studyDayStart(now, boundary.dayStartHour, boundary.timeZone)
    const firstDay = studyDayNumber(now, boundary.dayStartHour, boundary.timeZone)
    const end = new Date(start.getTime() + span * DAY_MS)

    const settings = await readSessionSettings(deps.repos, catalog)

    // From the epoch, not from `start`: everything already overdue lands on day 0, which is
    // what the daily session will actually serve.
    const rows = await deps.repos.cards.listDueBetween(new Date(0), end, {
      limit: FORECAST_MAX_CARDS,
    })

    const buckets: ForecastDay[] = []
    const index = new Map<number, ForecastDay>()
    for (let offset = 0; offset < span; offset++) {
      const dayNumber = firstDay + offset
      const bucket: ForecastDay = {
        day: studyDay(
          new Date(start.getTime() + offset * DAY_MS),
          boundary.dayStartHour,
          boundary.timeZone,
        ),
        offset,
        byLevel: zeroCounts(catalog),
        cards: 0,
        minutes: 0,
        newCards: 0,
        cardsWithNew: 0,
        minutesWithNew: 0,
      }
      buckets.push(bucket)
      index.set(dayNumber, bucket)
    }

    let backlog = 0
    let newPool = 0
    for (const row of rows) {
      if (row.state === CARD_STATE.New) {
        newPool += 1
        continue
      }
      const dayNumber = studyDayNumber(row.due, boundary.dayStartHour, boundary.timeZone)
      const bucket =
        index.get(dayNumber) ?? (dayNumber < firstDay ? index.get(firstDay) : undefined)
      if (bucket === undefined) continue
      if (dayNumber < firstDay) backlog += 1
      bucket.cards += 1
      ;(bucket.byLevel as Record<ImportanceLevel, number>)[row.level] += 1
    }

    const median = settings.medianSecondsPerCard || FALLBACK_MEDIAN_SECONDS
    let remaining = newPool
    for (const bucket of buckets) {
      bucket.minutes = (bucket.cards * median) / 60
      const introduced = Math.min(remaining, settings.dailyNewLimit)
      remaining -= introduced
      bucket.newCards = introduced
      bucket.cardsWithNew = bucket.cards + introduced
      bucket.minutesWithNew = (bucket.cardsWithNew * median) / 60
    }

    return {
      days: Object.freeze(buckets.map((bucket) => Object.freeze(bucket))),
      medianSecondsPerCard: median,
      backlog,
      newPool,
      dailyNewLimit: settings.dailyNewLimit,
      generatedAt: now,
    }
  }
}
