import type { JsonObject, OutboxEntry, OutboxOp } from '../entities'
import type { ListOptions } from './audit'

export interface OutboxAppend {
  tableName: string
  rowId: string
  op: OutboxOp
  /** The `version` the row carries *after* the change. */
  rowVersion: number
  payload?: JsonObject | null
}

/**
 * The change log a future sync layer drains (`docs/spec/07-architecture.md` §6).
 *
 * Empty in v1: repositories only append when `outboxEnabled` is on. It exists now so that
 * turning sync on later is a flag, not a migration and a rewrite.
 */
export interface OutboxRepository {
  append(entry: OutboxAppend): Promise<OutboxEntry>
  appendMany(entries: readonly OutboxAppend[]): Promise<OutboxEntry[]>
  /** Unsynced entries, oldest first. */
  listPending(options?: ListOptions): Promise<OutboxEntry[]>
  listForRow(tableName: string, rowId: string, options?: ListOptions): Promise<OutboxEntry[]>
  countPending(): Promise<number>
  markSynced(ids: readonly string[], at: Date): Promise<void>
  /** Records a push failure and increments `attempts`. */
  recordFailure(id: string, error: string): Promise<void>
}
