import type { SequencingLimits } from './types'

/**
 * Time arithmetic: the model's minutes are a prior clamped to a sane band, the pace turns a
 * total into weeks, and an exam date turns the weeks into a warning when they do not fit.
 * Pure over an injected `now`; nothing here reads a clock.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function lessonMinutes(
  estimate: number | null,
  limits: SequencingLimits['lessonMinutes'],
): number {
  if (estimate === null || Number.isNaN(estimate)) return limits.default
  return Math.min(limits.max, Math.max(limits.min, Math.round(estimate)))
}

/** Whole weeks at the given pace, or `null` when there is no pace to reckon with. */
export function weeksEstimate(totalMinutes: number, paceHoursPerWeek: number): number | null {
  if (paceHoursPerWeek <= 0) return null
  return Math.ceil(totalMinutes / (paceHoursPerWeek * 60))
}

/** Weeks from today (UTC) to an ISO date, to one decimal; `null` for a date that does not parse. */
export function weeksAvailable(now: Date, date: string): number | null {
  const match = ISO_DATE.exec(date)
  if (match === null) return null
  // `Date.UTC` normalises an out-of-range day or month rather than failing, so a string the
  // regex admits always yields a number.
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round(((target - today) / WEEK_MS) * 10) / 10
}
