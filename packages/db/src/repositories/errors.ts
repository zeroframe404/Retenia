import { EntityNotFoundError, OptimisticConcurrencyError } from '@retenia/core'

/**
 * Turns SQLite's constraint failures into errors a caller can branch on.
 *
 * The core error types are the contract; adapters must not invent their own, because the
 * shared contract suites — and the domain code — match on them.
 */

/** A `CHECK`, `NOT NULL`, `UNIQUE` or foreign-key constraint rejected the write. */
export class ConstraintViolationError extends Error {
  override readonly name = 'ConstraintViolationError'
  constructor(
    readonly table: string,
    readonly constraint: string,
    override readonly cause: unknown,
  ) {
    super(`${table}: the database rejected the write (${constraint})`, { cause })
  }
}

interface SqliteError {
  code?: string
  message?: string
}

function isSqliteConstraintError(error: unknown): error is SqliteError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as SqliteError).code === 'string' &&
    (error as SqliteError).code?.startsWith('SQLITE_CONSTRAINT') === true
  )
}

/**
 * Runs a write and rewrites a constraint failure into `ConstraintViolationError`, so a
 * broken JSON payload or a bad enum surfaces with the column that rejected it instead of a
 * bare `SQLITE_CONSTRAINT_CHECK` reaching the UI.
 */
export function mapConstraintErrors<T>(table: string, write: () => T): T {
  try {
    return write()
  } catch (error) {
    if (isSqliteConstraintError(error)) {
      throw new ConstraintViolationError(table, error.message ?? error.code ?? 'constraint', error)
    }
    throw error
  }
}

export { EntityNotFoundError, OptimisticConcurrencyError }
