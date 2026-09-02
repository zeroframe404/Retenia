import type { Clock, IdGenerator, JsonObject } from '@retenia/core'
import type { DrizzleDatabase } from '../open-database'
import type { TransactionRunner } from './transaction'

/** Everything a repository needs that is not its own table. One object, built once by
 *  `createRepositories`, shared by all of them. */
export interface RepositoryContext {
  readonly db: DrizzleDatabase
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly deviceId: string
  readonly outbox: OutboxWriter
  readonly run: TransactionRunner
}

/** The audit columns a fresh row gets. */
export interface AuditValues {
  createdAt: number
  updatedAt: number
  deletedAt: null
  deviceId: string
  version: number
}

export function auditValues(ctx: RepositoryContext, nowMs?: number): AuditValues {
  const now = nowMs ?? ctx.clock.now().getTime()
  return { createdAt: now, updatedAt: now, deletedAt: null, deviceId: ctx.deviceId, version: 1 }
}

export type OutboxOperation = 'insert' | 'update' | 'delete'

/** What the base repository hands the outbox after every mutation. Writing is a no-op when
 *  the flag is off or the table is not syncable. */
export interface OutboxWriter {
  readonly enabled: boolean
  append(
    op: OutboxOperation,
    tableName: string,
    row: { id: string; version: number },
    payload?: JsonObject | null,
  ): void
}
