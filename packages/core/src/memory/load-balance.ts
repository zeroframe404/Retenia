import { DAY_MS, type DayBoundary, resolveDayBoundary, studyDayNumber } from './study-day'
import type { LoadBalancer } from './types'

/**
 * The load balancer of `docs/spec/02-memory-system.md` §3.2 (i) and §15 — Anki 24.11's:
 * within the fuzz window `[min_ivl, max_ivl]`, book the day that already has the fewest
 * cards due.
 *
 * It runs *after* the interval, never instead of it. Every day it can choose was already an
 * acceptable due date for this card, so smoothing the calendar costs no retention — it only
 * stops cards created together from staying together forever.
 */

/** How far ahead contention is tracked. Beyond a year the calendar is empty enough that
 *  every candidate ties, and `maximum_interval` can be 36,500 days — an array that long,
 *  per review, would be waste. */
export const LOAD_BALANCE_HORIZON_DAYS = 365

export interface DueHistogram {
  /** Cards due on the study day `offset` days after the anchor. */
  countAt(offset: number): number
  /** Record a card newly booked on `due` — see `createLoadBalancer` for why this is not
   *  the balancer's own job. */
  note(due: Date): void
  /** Undo a `note`, for an undone review. */
  unnote(due: Date): void
  /** The study-day number `offset` 0 refers to. */
  readonly anchorDay: number
  readonly horizonDays: number
}

export interface DueHistogramOptions {
  now: Date
  boundary?: Partial<DayBoundary>
  horizonDays?: number
}

/**
 * Fold a due-date projection into a per-day count.
 *
 * Built from **one** `cards.listDueBetween` read, because the balancer is called once per
 * grade per review — up to four times for every card the review screen previews — and a
 * query per call would turn previewing a session into thousands of round trips.
 *
 * Anything already overdue collapses onto offset 0: a backlog is contention today, not on
 * the day it was originally booked for.
 */
export function buildDueHistogram(
  due: readonly { due: Date }[],
  options: DueHistogramOptions,
): DueHistogram {
  const boundary = resolveDayBoundary(options.boundary ?? {})
  const horizonDays = options.horizonDays ?? LOAD_BALANCE_HORIZON_DAYS
  const anchorDay = studyDayNumber(options.now, boundary.dayStartHour, boundary.timeZone)
  const counts = new Map<number, number>()

  const offsetOf = (at: Date): number =>
    Math.max(0, studyDayNumber(at, boundary.dayStartHour, boundary.timeZone) - anchorDay)

  const add = (at: Date, delta: number): void => {
    const offset = offsetOf(at)
    if (offset > horizonDays) return
    const next = (counts.get(offset) ?? 0) + delta
    if (next <= 0) counts.delete(offset)
    else counts.set(offset, next)
  }

  for (const entry of due) add(entry.due, 1)

  return {
    countAt: (offset) => counts.get(offset) ?? 0,
    note: (at) => add(at, 1),
    unnote: (at) => add(at, -1),
    anchorDay,
    horizonDays,
  }
}

/**
 * A balancer over `histogram`.
 *
 * **Deliberately pure: it counts nothing.** `Scheduler.preview` asks for all four grades of
 * every card it shows, so a balancer that booked the day it returned would record three
 * reviews that never happen for every one that does — poisoning its own counts within a
 * dozen cards. The one place that knows a review really happened calls `histogram.note`
 * instead, and an undo calls `unnote`.
 *
 * Ties break toward the day the scheduler originally wanted and then toward the earliest,
 * so the choice is deterministic and never drifts a card further from its interval than the
 * contention justifies.
 */
export function createLoadBalancer(
  histogram: DueHistogram,
  options: { now: Date; boundary?: Partial<DayBoundary> },
): LoadBalancer {
  const boundary = resolveDayBoundary(options.boundary ?? {})
  const anchorDay = studyDayNumber(options.now, boundary.dayStartHour, boundary.timeZone)
  return (candidates: Date[]): Date => {
    let best = candidates[0] as Date
    let bestCount = Number.POSITIVE_INFINITY
    for (const candidate of candidates) {
      const offset = studyDayNumber(candidate, boundary.dayStartHour, boundary.timeZone) - anchorDay
      const count = histogram.countAt(Math.max(0, offset))
      if (count < bestCount) {
        bestCount = count
        best = candidate
      }
    }
    return best
  }
}

/** The instant a card booked `days` from `now` falls on, same time of day — the shape
 *  `pickDay` hands the balancer. */
export function dueAfterDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS)
}
