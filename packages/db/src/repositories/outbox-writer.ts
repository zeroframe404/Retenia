import type { JsonObject } from '@retenia/core'
import { outbox } from '../schema'
import type { AuditValues, OutboxOperation, OutboxWriter, RepositoryContext } from './context'

/**
 * Tables whose writes are mirrored into `outbox` for a future sync layer.
 *
 * `outbox` itself is absent so the writer cannot feed itself; `jobs` and `ai_calls` are
 * absent because they are device-local bookkeeping — a job queued on this machine means
 * nothing on another, and the cost log follows the device that spent the money
 * (`docs/spec/07-architecture.md` §6).
 */
export const SYNCABLE_TABLES: ReadonlySet<string> = new Set([
  'achievements',
  'activities',
  'annotations',
  'attempts',
  'blobs',
  'cards',
  'chunks',
  'exam_attempts',
  'exam_items',
  'exams',
  'importance_levels',
  'item_bank',
  'knowledge_items',
  'lesson_sessions',
  'lessons',
  'modules',
  'path_versions',
  'paths',
  'review_logs',
  'review_sessions',
  'scheduler_profiles',
  'sections',
  'settings',
  'source_units',
  'sources',
  'streaks',
  'xp_events',
])

/** A writer that does nothing — v1's default, and what keeps `outbox` empty. */
export const disabledOutboxWriter: OutboxWriter = {
  enabled: false,
  append: () => undefined,
}

/**
 * The real writer. Deliberately **not** built on `createBaseRepository`: appending an
 * outbox row must never itself be mirrored, and making that structurally impossible beats
 * relying on the allowlist alone.
 */
export function createOutboxWriter(
  getContext: () => RepositoryContext,
  audit: () => AuditValues,
): OutboxWriter {
  return {
    enabled: true,
    append(
      op: OutboxOperation,
      tableName: string,
      row: { id: string; version: number },
      payload: JsonObject | null = null,
    ) {
      if (!SYNCABLE_TABLES.has(tableName)) return
      getContext()
        .db.insert(outbox)
        .values({
          id: getContext().ids.next(),
          tableName,
          rowId: row.id,
          op,
          rowVersion: row.version,
          payload,
          syncedAt: null,
          attempts: 0,
          error: null,
          ...audit(),
        })
        .run()
    },
  }
}
