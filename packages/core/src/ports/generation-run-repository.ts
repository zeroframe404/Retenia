import type { GenerationRun } from '../entities'
import type { CrudRepository, ListOptions } from './audit'

/**
 * The ledger of "Generate with AI" runs (sub-phase 8.1, `docs/spec/04-path-generation.md` §3
 * stages 3–5 and §13 step 2: "cancellable and resumable").
 *
 * Nothing here deletes: a run that failed is what explains a half-built draft, and a run
 * that succeeded is what a regeneration diffs against.
 */
export interface GenerationRunRepository extends CrudRepository<GenerationRun> {
  /** Every run of one path, newest first. */
  listByPath(pathId: string, options?: ListOptions): Promise<GenerationRun[]>
  /**
   * Every run not in a terminal status, oldest first — what a startup resume picks up, in
   * the order the work was asked for. `blocked_budget` counts as active: it is paused, not
   * finished, and the user's "continue anyway" is what un-pauses it.
   */
  listActive(): Promise<GenerationRun[]>
  /** The most recent run of a path, whatever its status. */
  findLatestByPath(pathId: string): Promise<GenerationRun | undefined>
}
