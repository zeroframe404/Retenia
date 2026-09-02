import type { JsonValue, SettingsKey, SettingsMap, SettingsRepository } from '@retenia/core'
import { SETTINGS } from '@retenia/core'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { settings } from '../schema'
import type { Row } from './base'
import { auditValues, type RepositoryContext } from './context'
import { mapConstraintErrors } from './errors'
import { toNumber, toText } from './mapping'

/**
 * Settings storage.
 *
 * Not built on `createBaseRepository`: the aggregate is the *key*, not the row id, and
 * `set` has to upsert against the `settings_key_live` partial unique index without ever
 * resurrecting a soft-deleted row.
 */
export function createSettingsRepository(ctx: RepositoryContext): SettingsRepository {
  function findLive(key: string): { id: string; value: JsonValue; version: number } | undefined {
    const rows = ctx.db
      .select({ id: settings.id, value: settings.value, version: settings.version })
      .from(settings)
      .where(and(eq(settings.key, key), isNull(settings.deletedAt)))
      .all() as Array<{ id: string; value: JsonValue; version: number }>
    return rows[0]
  }

  async function write(key: string, value: JsonValue): Promise<void> {
    await ctx.run(async () => {
      const at = ctx.clock.now().getTime()
      const existing = findLive(key)
      const rows = mapConstraintErrors('settings', () =>
        existing === undefined
          ? ctx.db
              .insert(settings)
              .values({ id: ctx.ids.next(), key, value, ...auditValues(ctx, at) })
              .returning()
              .all()
          : ctx.db
              .update(settings)
              .set({
                value,
                updatedAt: sql`max(${settings.updatedAt}, ${at})`,
                deviceId: ctx.deviceId,
                version: existing.version + 1,
              })
              .where(eq(settings.id, existing.id))
              .returning()
              .all(),
      ) as Row[]
      const row = rows[0]
      if (row === undefined) throw new Error('settings: write returned no row')
      ctx.outbox.append(existing === undefined ? 'insert' : 'update', 'settings', {
        id: toText(row.id),
        version: toNumber(row.version),
      })
    })
  }

  return {
    get: async <K extends SettingsKey>(key: K): Promise<SettingsMap[K]> => {
      const spec = SETTINGS[key]
      const stored = findLive(key)
      if (stored === undefined) return spec.defaultValue
      // A value written by a newer version — or corrupted — degrades to the default rather
      // than poisoning the caller.
      return spec.decode(stored.value) ?? spec.defaultValue
    },

    getStored: async () => {
      const out: Partial<SettingsMap> = {}
      for (const key of Object.keys(SETTINGS) as SettingsKey[]) {
        const stored = findLive(key)
        if (stored === undefined) continue
        const decoded = SETTINGS[key].decode(stored.value)
        if (decoded !== undefined) {
          ;(out as Record<string, unknown>)[key] = decoded
        }
      }
      return out
    },

    getRaw: async (key) => findLive(key)?.value,

    set: async <K extends SettingsKey>(key: K, value: SettingsMap[K]): Promise<void> => {
      await write(key, SETTINGS[key].encode(value) as JsonValue)
    },

    setRaw: (key, value) => write(key, value),

    /** Unknown keys are returned as they are and never pruned: a downgrade must not destroy
     *  a newer version's settings. */
    all: async () => {
      const rows = ctx.db
        .select({ key: settings.key, value: settings.value })
        .from(settings)
        .where(isNull(settings.deletedAt))
        .orderBy(asc(settings.key))
        .all() as Array<{ key: string; value: JsonValue }>
      return Object.fromEntries(rows.map((row) => [row.key, row.value]))
    },

    unset: async (key) => {
      await ctx.run(async () => {
        const existing = findLive(key)
        if (existing === undefined) return
        const at = ctx.clock.now().getTime()
        const rows = ctx.db
          .update(settings)
          .set({
            deletedAt: at,
            updatedAt: sql`max(${settings.updatedAt}, ${at})`,
            deviceId: ctx.deviceId,
            version: existing.version + 1,
          })
          .where(eq(settings.id, existing.id))
          .returning()
          .all() as Row[]
        const row = rows[0]
        if (row !== undefined) {
          ctx.outbox.append('delete', 'settings', {
            id: toText(row.id),
            version: toNumber(row.version),
          })
        }
      })
    },
  }
}
