import type { TransactionOptions } from '@retenia/core'
import type { OpenedDatabase } from '../open-database'

/**
 * The transaction runner.
 *
 * **Why this exists instead of `db.transaction()`.** `better-sqlite3`'s transaction wrapper
 * (which Drizzle's `db.transaction` delegates to) commits as soon as the callback *returns*,
 * and throws `TypeError: Transaction function cannot return a promise` when handed an async
 * one. An async callback returns its promise at the first `await`, synchronously — so the
 * wrapper would roll back and rethrow while the callback carried on running, committing the
 * rest of its statements one by one in autocommit mode. That is the worst possible outcome:
 * a partial write the caller is told did not happen. So the runner issues `BEGIN`/`COMMIT`
 * itself, around an awaited callback.
 *
 * **Why that is safe.** Every statement of this adapter runs synchronously on one
 * connection, and awaiting an already-resolved promise only yields the microtask queue,
 * which drains before any other task can run. Awaiting real I/O inside `work` would break
 * that (see `UnitOfWork.transaction`'s doc comment) — the mutex below bounds the damage to
 * one connection, it cannot prevent it.
 */

export interface TransactionState {
  /** 0 outside a transaction, 1 inside the outermost, n inside n-1 nested savepoints. */
  depth: number
}

type Mutex = <T>(work: () => Promise<T>) => Promise<T>

/** Serialises top-level transactions: two overlapping `BEGIN`s on one connection are an
 *  error, and the second callback's writes would otherwise land inside the first. */
function createMutex(): Mutex {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work, work)
    // Swallow rejections on the chain itself: a failed transaction must not poison the
    // queue for the next one. The real rejection still reaches the caller through `result`.
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

export type TransactionRunner = <T>(
  work: () => Promise<T> | T,
  options?: TransactionOptions,
) => Promise<T>

export function createTransactionRunner(
  opened: OpenedDatabase,
  state: TransactionState,
): TransactionRunner {
  const mutex = createMutex()

  return async function run<T>(
    work: () => Promise<T> | T,
    options: TransactionOptions = {},
  ): Promise<T> {
    if (state.depth > 0) {
      // Nested: a savepoint. Prefixed so it can never collide with Drizzle's own `sp0`,
      // `sp1`, … if some future code path does use its transaction helper.
      const name = `retenia_sp_${state.depth}`
      opened.sqlite.exec(`SAVEPOINT ${name}`)
      state.depth += 1
      try {
        const result = await work()
        opened.sqlite.exec(`RELEASE ${name}`)
        return result
      } catch (error) {
        opened.sqlite.exec(`ROLLBACK TO ${name}`)
        opened.sqlite.exec(`RELEASE ${name}`)
        throw error
      } finally {
        state.depth -= 1
      }
    }

    return mutex(async () => {
      const behavior = (options.behavior ?? 'immediate').toUpperCase()
      opened.sqlite.exec(`BEGIN ${behavior}`)
      state.depth = 1
      try {
        const result = await work()
        opened.sqlite.exec('COMMIT')
        return result
      } catch (error) {
        if (opened.sqlite.inTransaction) opened.sqlite.exec('ROLLBACK')
        throw error
      } finally {
        state.depth = 0
      }
    })
  }
}
