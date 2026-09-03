import type { Card } from '../entities'
import { DEFAULT_DECAY_PARAMETER, forgettingCurve } from './formulas'
import { type DayBoundary, resolveDayBoundary, studyDaysBetween } from './study-day'

/**
 * Visible decay (`docs/spec/02-memory-system.md` §7 rule 6): "today you recall this at
 * ~82 %".
 *
 * The scheduler is transparent (`docs/spec/01-decisions.md` §7.2): the user always sees `R`
 * — the probability of recalling an item right now — not just an opaque due date. These are
 * free functions over the forgetting curve rather than methods on `Scheduler`, so a UI can
 * label a card without instantiating one.
 */

/** The four bands `packages/ui`'s `MemoryStrengthBar` paints. */
export type StrengthBand = 'critical' | 'weak' | 'good' | 'strong'

/** Upper bound of each band, ascending. Read `max` as inclusive. */
export const STRENGTH_BANDS: readonly { readonly max: number; readonly band: StrengthBand }[] =
  Object.freeze([
    Object.freeze({ max: 0.3, band: 'critical' as StrengthBand }),
    Object.freeze({ max: 0.6, band: 'weak' as StrengthBand }),
    Object.freeze({ max: 0.85, band: 'good' as StrengthBand }),
    Object.freeze({ max: Number.POSITIVE_INFINITY, band: 'strong' as StrengthBand }),
  ])

/** Which band an `R` in `[0, 1]` falls in. Values outside the range are clamped. */
export function strengthBand(retrievability: number): StrengthBand {
  const clamped = Number.isFinite(retrievability) ? Math.min(1, Math.max(0, retrievability)) : 0
  // The last band's `max` is +Infinity, so `find` always matches.
  return (STRENGTH_BANDS.find((entry) => clamped <= entry.max) as (typeof STRENGTH_BANDS)[number])
    .band
}

export interface RetrievabilityOptions {
  /** `w20`, the decay of the forgetting curve. Defaults to FSRS-6's 0.1542. */
  w20?: number
  dayBoundary?: Partial<DayBoundary>
}

/**
 * `R` right now — §3.2 (a) evaluated at the study days elapsed since the last review.
 *
 * `0` for a card that has never been reviewed (`lastReview === null` or `S = 0`): there is
 * no memory to retrieve yet, which is what `Scheduler.retrievability` also reports.
 */
export function retrievabilityNow(
  card: Card,
  now: Date,
  options: RetrievabilityOptions = {},
): number {
  if (card.lastReview === null || card.stability <= 0) return 0
  const boundary = resolveDayBoundary(options.dayBoundary ?? {})
  const elapsed = studyDaysBetween(card.lastReview, now, boundary.dayStartHour, boundary.timeZone)
  return forgettingCurve(elapsed, card.stability, options.w20 ?? DEFAULT_DECAY_PARAMETER)
}

export interface StrengthLabel {
  /** `R` as a whole percentage, 0–100 — the "82" of "~82 % hoy". */
  percent: number
  band: StrengthBand
  /** `false` for a card never reviewed: there is nothing to report yet, and the UI should
   *  say so rather than claim 0 %. */
  known: boolean
}

/**
 * The numbers behind "~82 % hoy". The sentence itself is an i18n string
 * (`review.strength.label`) — `packages/core` holds no UI copy
 * (`docs/spec/00-conventions.md`).
 */
export function strengthLabel(
  card: Card,
  now: Date,
  options: RetrievabilityOptions = {},
): StrengthLabel {
  const known = card.lastReview !== null && card.stability > 0
  const retrievability = retrievabilityNow(card, now, options)
  return { percent: Math.round(retrievability * 100), band: strengthBand(retrievability), known }
}
