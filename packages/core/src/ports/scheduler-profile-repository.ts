import type { SchedulerProfile } from '../entities'
import type { CrudRepository } from './audit'

/**
 * The FSRS parameters in force, per scope (`docs/spec/02-memory-system.md` §6, §14).
 *
 * `global` is the only scope in v1; §16 leaves the door open to a profile per domain once
 * one has ≥ 1,000 reviews of its own. Rows are addressed by `scope`, which a partial unique
 * index keeps unique among live rows.
 */

/** The global scope: the parameters every card is scheduled with until per-domain profiles
 *  exist. */
export const GLOBAL_SCHEDULER_SCOPE = 'global'

/** What one accepted optimizer run writes (§14's `scheduler_profiles` columns). */
export interface TrainedParameters {
  /** `w0…w20`, already clamped to §3.3's ranges. */
  w: readonly number[]
  /** `w20`, mirrored into its own column for the forgetting-curve helpers. */
  decay: number
  trainedAt: Date
  /** How many reviews the run was trained on — what §16's "every 2ⁿ reviews" counts against. */
  nReviews: number
  logLoss: number
  rmse: number
}

export interface SchedulerProfileRepository extends CrudRepository<SchedulerProfile> {
  findByScope(scope: string): Promise<SchedulerProfile | undefined>
  /**
   * The profile for `scope`, created with the published FSRS-6 defaults if it does not
   * exist yet.
   *
   * A lazy upsert rather than a seed migration: the defaults live in
   * `memory/parameters.ts` (`DEFAULT_FSRS_W`), and a migration copying them into SQLite
   * would be a second source of truth that silently goes stale the day `ts-fsrs` ships new
   * defaults.
   */
  ensure(scope: string): Promise<SchedulerProfile>
  /**
   * Record an optimization the health check accepted (§16).
   *
   * Writes parameters only. It never touches a card: §7 rule 2 and §16 both forbid a mass
   * reschedule on apply — the new `w` applies from each card's next review, and S and D
   * stay exactly where the scheduler left them.
   */
  saveTrained(scope: string, trained: TrainedParameters): Promise<SchedulerProfile>
}
