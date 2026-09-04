import { IMPORTANCE_LEVELS, type ImportanceLevel } from '../entities'
import type { Forecast, ForecastQuery } from '../memory/forecast'
import { DEFAULT_IMPORTANCE_CATALOG, type ImportanceCatalog } from '../memory/importance'
import {
  DAY_MS,
  type DayBoundary,
  resolveDayBoundary,
  studyDay,
  studyDayNumber,
  studyDayStart,
} from '../memory/study-day'
import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import type { StatsRepository } from '../ports/stats-repository'
import { computeDistribution, type MemoryDistribution } from './distribution'
import { computeMemorized, MEMORIZED_MAX_DAYS, type Memorized } from './memorized'
import {
  firstOfDay,
  type LevelRetention,
  RETENTION_WINDOWS,
  type RetentionWindow,
  retentionByLevel,
  type TrueRetention,
  tallyRetention,
} from './true-retention'

/**
 * The statistics screen's six cards, in one read — the first six rows of
 * `docs/spec/02-memory-system.md` §13. (The remaining nine rows — heatmap, time per card,
 * answer buttons, decay forecast, mastery, readiness, leeches, workload simulation — are
 * sub-phase 13.2's.)
 *
 * One query object rather than six channels because every card is a different projection of
 * the same two reads: the reviews in the window and the current memory states. Splitting
 * them would have the screen read the whole review history six times to draw one page.
 *
 * The exception is the forecast, which sub-phase 4.3 already built and which reads *future*
 * due dates rather than past reviews — it is injected here and reused, never reimplemented.
 */

/** Ceilings on one read, so the screen cannot fetch an unbounded table. */
export const STATS_MAX_EVENTS = 200_000
export const STATS_MAX_CARDS = 100_000
/** Days of `Σ R` history the overview draws by default. */
export const MEMORIZED_DEFAULT_DAYS = 30
/**
 * The window the overview answers rows 1 and 2 over.
 *
 * A month is the shortest span that usually holds enough first-of-day reviews for the
 * per-level comparison to mean anything, and short enough that opening the screen reads a
 * month of history rather than a year.
 */
export const OVERVIEW_RETENTION_WINDOW: RetentionWindow = 'month'
/** Days of forecast the overview draws by default — §13 asks for 30/90. */
export const FORECAST_DEFAULT_DAYS = 30

export interface StatsOverview {
  /**
   * §13 row 1, over `OVERVIEW_RETENTION_WINDOW`.
   *
   * One window, not all four: the year window would make every page load read a year of
   * `review_logs` synchronously, for three numbers the user may never look at. The
   * switcher asks for the others through `trueRetention` when it needs them.
   */
  trueRetention: TrueRetention
  /** §13 row 2, over the same window — the shortest span with enough reviews to judge. */
  byLevel: readonly LevelRetention[]
  /** True whenever any level's gap exceeds 5 pp: the screen's "re-optimize" prompt. */
  retentionAlert: boolean
  /** §13 rows 3 and 4. */
  memorized: Memorized
  /** §13 row 5. */
  distribution: MemoryDistribution
  /** §13 row 6, from sub-phase 4.3's `createForecast`. `null` when none was injected. */
  forecast: Forecast | null
  generatedAt: Date
}

export interface StatsDeps {
  repos: StatsRepository
  /** Supplies each level's desired retention for §13 row 2. */
  catalog?: ImportanceCatalog
  /** Sub-phase 4.3's forecast, reused rather than rebuilt. */
  forecast?: ForecastQuery
  clock?: Clock
  dayBoundary?: Partial<DayBoundary>
  /** `w20` for the forgetting curve; the user's own once the optimizer has run. */
  w20?: number
}

export interface StatsQueryOptions {
  /** Days of `Σ R` series. Defaults to 30, capped at a year. */
  memorizedDays?: number
  /** Days of forecast. Defaults to 30. */
  forecastDays?: number
  now?: Date
}

export interface StatsQueries {
  /** Everything the six cards need, from two reads. */
  overview(options?: StatsQueryOptions): Promise<StatsOverview>
  /** One window on its own — what the card's day/week/month/year switcher calls. */
  trueRetention(window: RetentionWindow, now?: Date): Promise<TrueRetention>
}

/** The window's first study day, and the instant it began. */
function windowStart(window: RetentionWindow, now: Date, boundary: DayBoundary): Date {
  const today = studyDayStart(now, boundary.dayStartHour, boundary.timeZone)
  return new Date(today.getTime() - (RETENTION_WINDOWS[window] - 1) * DAY_MS)
}

export function createStatsQueries(deps: StatsDeps): StatsQueries {
  const catalog = deps.catalog ?? DEFAULT_IMPORTANCE_CATALOG
  const clock = deps.clock ?? systemClock
  const boundary = resolveDayBoundary(deps.dayBoundary)
  const studyDayOf = (at: Date) => studyDayNumber(at, boundary.dayStartHour, boundary.timeZone)

  const desiredFor = (level: ImportanceLevel): number | null => catalog.get(level).desiredRetention

  async function retentionFor(window: RetentionWindow, now: Date): Promise<TrueRetention> {
    const from = windowStart(window, now, boundary)
    // `to` is `now`, not the end of today: a review cannot have happened in the future, and
    // an open-ended upper bound would let a clock that jumped forward pull rows in.
    const events = await deps.repos.listReviewEvents(from, now, { limit: STATS_MAX_EVENTS })
    return {
      window,
      from: studyDay(from, boundary.dayStartHour, boundary.timeZone),
      ...tallyRetention(firstOfDay(events, studyDayOf)),
    }
  }

  return {
    trueRetention: (window, now) => retentionFor(window, now ?? clock.now()),

    overview: async (options = {}) => {
      const now = options.now ?? clock.now()
      const memorizedDays = Math.min(
        MEMORIZED_MAX_DAYS,
        Math.max(1, Math.floor(options.memorizedDays ?? MEMORIZED_DEFAULT_DAYS)),
      )

      // The read spans whichever of the two needs more history — the retention window or
      // the `Σ R` series — and nothing beyond it.
      const retentionStart = windowStart(OVERVIEW_RETENTION_WINDOW, now, boundary)
      const seriesStart = new Date(
        studyDayStart(now, boundary.dayStartHour, boundary.timeZone).getTime() -
          (memorizedDays - 1) * DAY_MS,
      )
      const from = new Date(Math.min(retentionStart.getTime(), seriesStart.getTime()))

      const [events, cards, forecast] = await Promise.all([
        deps.repos.listReviewEvents(from, now, { limit: STATS_MAX_EVENTS }),
        deps.repos.listMemoryStates({ limit: STATS_MAX_CARDS }),
        deps.forecast === undefined
          ? Promise.resolve(null)
          : deps.forecast(
              Math.max(1, Math.floor(options.forecastDays ?? FORECAST_DEFAULT_DAYS)),
              now,
            ),
      ])

      // The series may reach further back than the retention window, so the reviews are
      // filtered to it rather than being taken wholesale from the read.
      const start = retentionStart.getTime()
      const qualifying = firstOfDay(events, studyDayOf).filter(
        (event) => event.review.getTime() >= start,
      )
      const trueRetention: TrueRetention = {
        window: OVERVIEW_RETENTION_WINDOW,
        from: studyDay(retentionStart, boundary.dayStartHour, boundary.timeZone),
        ...tallyRetention(qualifying),
      }
      const byLevel = retentionByLevel(qualifying, desiredFor, IMPORTANCE_LEVELS)

      return {
        trueRetention,
        byLevel,
        retentionAlert: byLevel.some((entry) => entry.alert),
        memorized: computeMemorized({
          cards,
          events,
          now,
          days: memorizedDays,
          boundary,
          ...(deps.w20 === undefined ? {} : { w20: deps.w20 }),
        }),
        distribution: computeDistribution(cards),
        forecast,
        generatedAt: now,
      }
    },
  }
}
