import type { ActivityPace } from '../memory/pace'

/**
 * The materialized per-activity-type pace (`docs/spec/02-memory-system.md` §10's "personal
 * median").
 *
 * Deliberately not a `CrudRepository`: the rows are **derived state**, keyed by the
 * activity type rather than by a UUID the rest of the app knows, and nothing outside the
 * review path ever creates or deletes one. Losing the whole table costs nothing but the
 * warm-up — the next reviews rebuild it, and an unknown median only means speed stops
 * being evidence, never that a rating comes out wrong.
 */
export interface ActivityStatsRepository {
  find(activityType: string): Promise<ActivityPace | undefined>
  list(): Promise<ActivityPace[]>
  /**
   * The one number `toRating` needs, without the sample behind it. `null` when the type has
   * no history yet.
   */
  medianMs(activityType: string): Promise<number | null>
  /**
   * Folds one review's duration into the type's rolling window and returns the new row.
   *
   * Upserts: the first review of a type creates it. Non-positive durations are ignored, so
   * a host that did not measure the time cannot poison the median.
   */
  record(activityType: string, durationMs: number): Promise<ActivityPace>
}
