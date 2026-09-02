/** The errors repository ports throw. Adapters must use these, not their own: consumers
 *  (and the shared contract tests) branch on them. */

/** An update, save or delete named a row that does not exist (or is soft-deleted). */
export class EntityNotFoundError extends Error {
  override readonly name = 'EntityNotFoundError'
  constructor(
    readonly table: string,
    readonly id: string,
  ) {
    super(`${table}: no live row with id ${id}`)
  }
}

/** A patch carried a `version` that no longer matches the stored row: someone else wrote
 *  first. Nothing was changed. */
export class OptimisticConcurrencyError extends Error {
  override readonly name = 'OptimisticConcurrencyError'
  constructor(
    readonly table: string,
    readonly id: string,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(
      `${table}: row ${id} is at version ${actualVersion}, the update expected ${expectedVersion}`,
    )
  }
}

/** Something tried to mutate an append-only row (`review_logs`, `xp_events`). */
export class AppendOnlyViolationError extends Error {
  override readonly name = 'AppendOnlyViolationError'
  constructor(
    readonly table: string,
    readonly id: string,
  ) {
    super(`${table} is append-only: row ${id} cannot be updated`)
  }
}
