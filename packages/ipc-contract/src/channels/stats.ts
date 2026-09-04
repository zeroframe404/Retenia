import { z } from 'zod'
import { defineContract } from '../define'
import { forecastSchema, importanceLevelSchema } from './memory'

/**
 * The statistics screen's read-only surface — the first six rows of
 * `docs/spec/02-memory-system.md` §13: true retention, desired vs true per level, mean
 * retention today, memorized knowledge, the S/D distributions, and the forecast sub-phase
 * 4.3 already built. (Rows 7–15 — heatmap, time per card, answer buttons, decay forecast,
 * mastery, readiness, leeches, workload simulation — are sub-phase 13.2's.)
 *
 * Two channels, not six. `stats.overview` is one read that draws the whole page, because
 * every card is a projection of the same two queries and six channels would walk the review
 * history six times. It answers the retention card over **one** window (a month), so opening
 * the screen costs a month of `review_logs` and not a year; `stats.trueRetention` reads a
 * different window when the switcher asks for one, which is the only time a year of history
 * is worth touching.
 *
 * Nothing here writes, so no channel takes a confirmation.
 */

export const RETENTION_WINDOWS = ['day', 'week', 'month', 'year'] as const
export const retentionWindowSchema = z.enum(RETENTION_WINDOWS)
export type RetentionWindow = z.infer<typeof retentionWindowSchema>

/** `null` rather than `0` when nothing qualified: no reviews is not 0 % retention. */
const retentionCountSchema = z.object({
  reviewed: z.int().nonnegative(),
  correct: z.int().nonnegative(),
  retention: z.number().min(0).max(1).nullable(),
})

export const trueRetentionSchema = z.object({
  window: retentionWindowSchema,
  /** The study day the window opens on, ISO `YYYY-MM-DD`. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Cards whose scheduled interval was under 21 days. */
  young: retentionCountSchema,
  mature: retentionCountSchema,
  all: retentionCountSchema,
})
export type TrueRetention = z.infer<typeof trueRetentionSchema>

/** §13 row 2: the per-level comparison and its > 5 pp alert. */
export const levelRetentionSchema = z.object({
  level: importanceLevelSchema,
  desiredRetention: z.number().min(0).max(1).nullable(),
  trueRetention: z.number().min(0).max(1).nullable(),
  reviewed: z.int().nonnegative(),
  /** `true − desired`; negative means the intervals are outrunning the level. */
  gap: z.number().min(-1).max(1).nullable(),
  alert: z.boolean(),
})

const memorizedDaySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Days before today; `0` is today. */
  offset: z.int().nonnegative(),
  memorized: z.number().nonnegative(),
  cards: z.int().nonnegative(),
})

/** §13 rows 3 and 4: `mean R(today)` and `Σ R(today)` with its series. */
export const memorizedSchema = z.object({
  today: z.number().nonnegative(),
  meanRetrievability: z.number().min(0).max(1).nullable(),
  reviewCards: z.int().nonnegative(),
  totalCards: z.int().nonnegative(),
  series: z.array(memorizedDaySchema),
  generatedAt: z.iso.datetime(),
})

const histogramBinSchema = z.object({
  label: z.string(),
  from: z.number().nonnegative(),
  /** `null` on the open-ended top bin — JSON has no `Infinity`. */
  to: z.number().nonnegative().nullable(),
  count: z.int().nonnegative(),
  share: z.number().min(0).max(1),
})

/** §13 row 5: the S and D histograms, and the two shares the spec singles out. */
export const distributionSchema = z.object({
  stability: z.array(histogramBinSchema),
  difficulty: z.array(histogramBinSchema),
  cards: z.int().nonnegative(),
  shareOver21Days: z.number().min(0).max(1),
  shareOver365Days: z.number().min(0).max(1),
  meanStability: z.number().nonnegative().nullable(),
  meanDifficulty: z.number().min(0).max(10).nullable(),
})

export const statsOverviewSchema = z.object({
  /** The default window (a month). Other windows come from `stats.trueRetention`. */
  trueRetention: trueRetentionSchema,
  byLevel: z.array(levelRetentionSchema),
  retentionAlert: z.boolean(),
  memorized: memorizedSchema,
  distribution: distributionSchema,
  /** `null` only if the main process has no forecast wired in, which shipping code always
   *  does — the screen still renders its other five cards. */
  forecast: forecastSchema.nullable(),
  generatedAt: z.iso.datetime(),
})
export type StatsOverview = z.infer<typeof statsOverviewSchema>

/** A year of daily points is the longest §13's windows ask for; the cap bounds one read. */
export const STATS_MAX_SERIES_DAYS = 365
export const STATS_MAX_FORECAST_DAYS = 365

export const statsChannels = defineContract({
  /** Everything the six cards need, in one read. */
  'stats.overview': {
    input: z.object({
      /** Days of `Σ R` history. Defaults in main to 30. */
      memorizedDays: z.int().min(1).max(STATS_MAX_SERIES_DAYS).optional(),
      /** Days of forecast. §13 asks for 30/90; defaults in main to 30. */
      forecastDays: z.int().min(1).max(STATS_MAX_FORECAST_DAYS).optional(),
    }),
    output: statsOverviewSchema,
  },

  /** One window on its own — what the true-retention card's switcher calls. */
  'stats.trueRetention': {
    input: z.object({ window: retentionWindowSchema }),
    output: trueRetentionSchema,
  },
})
