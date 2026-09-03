import type { ImportanceLevel, ImportanceLevelConfig } from '../entities'
import type { CrudRepository } from './audit'

/**
 * The five rows of `importance_levels` (`docs/spec/02-memory-system.md` §7).
 *
 * They are seeded by migration `0001` and addressed by `name`, never created or deleted at
 * runtime: a level is a fixed vocabulary item, and dropping one would orphan every card
 * pointing at it. `CrudRepository`'s `create`/`softDelete` exist for uniformity (and for
 * sync, which addresses rows by their UUIDv7 `id` like every other table); the app only
 * ever reads them and tunes the numbers.
 */

/** The knobs a user may turn: maintenance's 0.80–0.85 retention range, the new-item quota,
 *  the leech threshold and action. `name` and `orderRank` are the vocabulary and are not
 *  patchable — reordering the five levels would change what "1st under overload" means. */
export type ImportanceLevelPatch = Partial<
  Pick<
    ImportanceLevelConfig,
    | 'desiredRetention'
    | 'maxIntervalDays'
    | 'postponeAllowed'
    | 'newPerDay'
    | 'leechThreshold'
    | 'leechAction'
  >
> & { version?: number }

export interface ImportanceLevelRepository extends CrudRepository<ImportanceLevelConfig> {
  /** `name` is the natural key the code uses (`urgent`, `high`, …). */
  findByName(name: ImportanceLevel): Promise<ImportanceLevelConfig | undefined>
  /** Every level, review order first (`orderRank` ascending) — what the catalog is built
   *  from. */
  listOrdered(): Promise<ImportanceLevelConfig[]>
  updateByName(name: ImportanceLevel, patch: ImportanceLevelPatch): Promise<ImportanceLevelConfig>
}
