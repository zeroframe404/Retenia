import type { ActivityPace, ActivityStatsRepository } from '@retenia/core'
import { foldPace, PACE_SAMPLE_SIZE } from '@retenia/core'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { activityStats } from '../schema'
import type { Row } from './base'
import { auditValues, type RepositoryContext } from './context'
import { mapConstraintErrors } from './errors'
import { toNumber, toNumberOrNull, toText } from './mapping'

/**
 * The materialized per-type pace behind §10's "personal median".
 *
 * Not built on `createBaseRepository`, for the same reason `settings` is not: the aggregate
 * is the **activity type**, not a row id the rest of the app knows, and `record` has to
 * upsert against the `activity_stats_activity_type_unique` index.
 *
 * The rolling median itself is `@retenia/core`'s `foldPace` — this file only reads the row,
 * hands it over, and writes back what comes out. Keeping the arithmetic in core is what
 * lets `packages/core` test the window's behaviour without a database.
 */

/** The stored `sample` is a JSON array; anything else in it is treated as no history. */
function toSample(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry) && entry > 0,
  )
}

function toEntity(row: Row): ActivityPace {
  return {
    activityType: toText(row.activityType),
    reviews: toNumber(row.reviews),
    medianMs: toNumberOrNull(row.medianMs),
    sample: toSample(row.sample),
  }
}

export function createActivityStatsRepository(ctx: RepositoryContext): ActivityStatsRepository {
  function findRow(
    activityType: string,
  ): { id: string; version: number; pace: ActivityPace } | undefined {
    const rows = ctx.db
      .select()
      .from(activityStats)
      .where(and(eq(activityStats.activityType, activityType), isNull(activityStats.deletedAt)))
      .all() as Row[]
    const row = rows[0]
    if (row === undefined) return undefined
    return { id: toText(row.id), version: toNumber(row.version), pace: toEntity(row) }
  }

  return {
    find: async (activityType) => findRow(activityType)?.pace,

    list: async () =>
      (
        ctx.db
          .select()
          .from(activityStats)
          .where(isNull(activityStats.deletedAt))
          .orderBy(asc(activityStats.activityType))
          .all() as Row[]
      ).map(toEntity),

    medianMs: async (activityType) => findRow(activityType)?.pace.medianMs ?? null,

    record: async (activityType, durationMs) =>
      ctx.run(async () => {
        const existing = findRow(activityType)
        const next = foldPace(existing?.pace, activityType, durationMs, PACE_SAMPLE_SIZE)
        // `foldPace` returns the row unchanged for a duration it will not count (an
        // unmeasured answer). Writing it back would burn a `version` and an outbox row for
        // nothing — and, on a type's very first review, would create an empty row claiming
        // a history it does not have — so the no-op is detected here, not sent onward.
        if (next.reviews === (existing?.pace.reviews ?? 0)) return next

        const at = ctx.clock.now().getTime()
        const values = {
          reviews: next.reviews,
          medianMs: next.medianMs,
          sample: [...next.sample],
        }
        const rows = mapConstraintErrors('activity_stats', () =>
          existing === undefined
            ? ctx.db
                .insert(activityStats)
                .values({
                  id: ctx.ids.next(),
                  activityType,
                  ...values,
                  ...auditValues(ctx, at),
                })
                .returning()
                .all()
            : ctx.db
                .update(activityStats)
                .set({
                  ...values,
                  updatedAt: sql`max(${activityStats.updatedAt}, ${at})`,
                  deviceId: ctx.deviceId,
                  version: existing.version + 1,
                })
                .where(eq(activityStats.id, existing.id))
                .returning()
                .all(),
        ) as Row[]
        const row = rows[0]
        if (row === undefined) throw new Error('activity_stats: write returned no row')
        ctx.outbox.append(existing === undefined ? 'insert' : 'update', 'activity_stats', {
          id: toText(row.id),
          version: toNumber(row.version),
        })
        return toEntity(row)
      }),
  }
}
