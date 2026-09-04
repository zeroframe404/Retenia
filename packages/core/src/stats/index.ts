/**
 * The statistics of `docs/spec/02-memory-system.md` §13 — the first six rows: true
 * retention, desired vs true per level, mean retention today, memorized knowledge,
 * the S/D distributions, and the forecast sub-phase 4.3 already built.
 *
 * Pure functions over two projections (`StatsRepository`), so every number on the screen
 * can be checked against a hand-computed fixture without a database.
 */

export type { HistogramBin, MemoryDistribution } from './distribution'
export {
  computeDistribution,
  DIFFICULTY_BIN_COUNT,
  emptyDistribution,
  STABILITY_BINS,
} from './distribution'
export type { Memorized, MemorizedDay, MemorizedInput } from './memorized'
export { computeMemorized, MEMORIZED_MAX_DAYS } from './memorized'
export type { StatsDeps, StatsOverview, StatsQueries, StatsQueryOptions } from './overview'
export {
  createStatsQueries,
  FORECAST_DEFAULT_DAYS,
  MEMORIZED_DEFAULT_DAYS,
  OVERVIEW_RETENTION_WINDOW,
  STATS_MAX_CARDS,
  STATS_MAX_EVENTS,
} from './overview'
export type {
  LevelRetention,
  RetentionCount,
  RetentionWindow,
  TrueRetention,
} from './true-retention'
export {
  EMPTY_COUNT,
  firstOfDay,
  isRecalled,
  isRetentionEvidence,
  MATURE_INTERVAL_DAYS,
  RETENTION_ALERT_POINTS,
  RETENTION_WINDOW_NAMES,
  RETENTION_WINDOWS,
  retentionByLevel,
  tallyRetention,
} from './true-retention'
