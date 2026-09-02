import type {
  Achievement,
  GamificationRepository,
  NewEntity,
  Streak,
  XpEvent,
  XpRange,
} from '@retenia/core'
import { EntityNotFoundError } from '@retenia/core'
import { and, asc, eq, gte, isNull, lt, type SQL, sql } from 'drizzle-orm'
import { achievements, streaks, xpEvents } from '../schema'
import { createBaseRepository, type Row, type TableCodec } from './base'
import type { RepositoryContext } from './context'
import {
  defined,
  toDate,
  toDateOrNull,
  toJsonObjectOrNull,
  toNumber,
  toStringArray,
  toText,
  toTextOrNull,
} from './mapping'

const xpCodec: TableCodec<
  XpEvent,
  NewEntity<XpEvent>,
  Partial<NewEntity<XpEvent>> & { version?: number }
> = {
  table: xpEvents,
  name: 'xp_events',
  toEntity: (row: Row): XpEvent => ({
    id: toText(row.id),
    amount: toNumber(row.amount),
    reason: row.reason as XpEvent['reason'],
    subjectKind: toTextOrNull(row.subjectKind),
    subjectId: toTextOrNull(row.subjectId),
    occurredAt: toDate(row.occurredAt),
    multiplier: toNumber(row.multiplier),
    meta: toJsonObjectOrNull(row.meta),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      amount: input.amount,
      reason: input.reason,
      subjectKind: input.subjectKind ?? null,
      subjectId: input.subjectId ?? null,
      occurredAt: input.occurredAt.getTime(),
      multiplier: input.multiplier,
      meta: input.meta ?? null,
    }),
  toUpdate: () => ({}),
}

const streakCodec: TableCodec<
  Streak,
  NewEntity<Streak>,
  Partial<NewEntity<Streak>> & { version?: number }
> = {
  table: streaks,
  name: 'streaks',
  toEntity: (row: Row): Streak => ({
    id: toText(row.id),
    kind: toText(row.kind),
    currentLength: toNumber(row.currentLength),
    longestLength: toNumber(row.longestLength),
    goal: toNumber(row.goal),
    lastActiveDay: toTextOrNull(row.lastActiveDay),
    startedOn: toTextOrNull(row.startedOn),
    freezesAvailable: toNumber(row.freezesAvailable),
    freezesUsed: toNumber(row.freezesUsed),
    freezeBankMax: toNumber(row.freezeBankMax),
    holidays: toStringArray(row.holidays),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      kind: input.kind,
      currentLength: input.currentLength,
      longestLength: input.longestLength,
      goal: input.goal,
      lastActiveDay: input.lastActiveDay ?? null,
      startedOn: input.startedOn ?? null,
      freezesAvailable: input.freezesAvailable,
      freezesUsed: input.freezesUsed,
      freezeBankMax: input.freezeBankMax,
      holidays: input.holidays,
    }),
  toUpdate: (patch) =>
    defined({
      currentLength: patch.currentLength,
      longestLength: patch.longestLength,
      goal: patch.goal,
      lastActiveDay: patch.lastActiveDay,
      startedOn: patch.startedOn,
      freezesAvailable: patch.freezesAvailable,
      freezesUsed: patch.freezesUsed,
      freezeBankMax: patch.freezeBankMax,
      holidays: patch.holidays,
    }),
}

const achievementCodec: TableCodec<
  Achievement,
  NewEntity<Achievement>,
  Partial<NewEntity<Achievement>> & { version?: number }
> = {
  table: achievements,
  name: 'achievements',
  toEntity: (row: Row): Achievement => ({
    id: toText(row.id),
    key: toText(row.key),
    progress: toNumber(row.progress),
    target: toNumber(row.target),
    unlockedAt: toDateOrNull(row.unlockedAt),
    meta: toJsonObjectOrNull(row.meta),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      key: input.key,
      progress: input.progress,
      target: input.target,
      unlockedAt:
        input.unlockedAt === null || input.unlockedAt === undefined
          ? null
          : input.unlockedAt.getTime(),
      meta: input.meta ?? null,
    }),
  toUpdate: (patch) =>
    defined({
      progress: patch.progress,
      target: patch.target,
      unlockedAt:
        patch.unlockedAt === undefined ? undefined : (patch.unlockedAt?.getTime() ?? null),
      meta: patch.meta,
    }),
}

export function createGamificationRepository(ctx: RepositoryContext): GamificationRepository {
  const xp = createBaseRepository(ctx, xpCodec)
  const streakRepo = createBaseRepository(ctx, streakCodec)
  const achievementRepo = createBaseRepository(ctx, achievementCodec)

  function rangePredicate(range?: XpRange): SQL | undefined {
    return and(
      isNull(xpEvents.deletedAt),
      range === undefined ? undefined : gte(xpEvents.occurredAt, range.from.getTime()),
      range?.to === undefined ? undefined : lt(xpEvents.occurredAt, range.to.getTime()),
    )
  }

  return {
    appendXp: xp.create,

    listXp: (range, options) =>
      xp.findWhere(rangePredicate(range), {
        ...options,
        orderBy: [asc(xpEvents.occurredAt), asc(xpEvents.id)],
      }),

    /** Derived from the ledger, never stored: a total can then never drift from its
     *  history. Floored, because XP is a whole number in the UI. */
    totalXp: async (range) => {
      const rows = ctx.db
        .select({ total: sql<number | null>`sum(${xpEvents.amount} * ${xpEvents.multiplier})` })
        .from(xpEvents)
        .where(rangePredicate(range))
        .all() as Array<{ total: number | null }>
      return Math.floor(Number(rows[0]?.total ?? 0))
    },

    /** Calendar days in UTC. The user's day-start hour is a presentation concern the
     *  statistics screen applies (`review.dayStartHour`). */
    xpByDay: async (range) => {
      const day = sql<string>`strftime('%Y-%m-%d', ${xpEvents.occurredAt} / 1000, 'unixepoch')`
      const rows = ctx.db
        .select({ day, xp: sql<number>`sum(${xpEvents.amount} * ${xpEvents.multiplier})` })
        .from(xpEvents)
        .where(rangePredicate(range))
        .groupBy(day)
        .orderBy(asc(day))
        .all() as Array<{ day: string; xp: number }>
      return rows.map((row) => ({ day: row.day, xp: Math.floor(Number(row.xp)) }))
    },

    getStreak: async (kind) => (await streakRepo.findWhere(eq(streaks.kind, kind)))[0],

    createStreak: streakRepo.create,

    updateStreak: async (kind, patch) =>
      ctx.run(async () => {
        const existing = (await streakRepo.findWhere(eq(streaks.kind, kind)))[0]
        if (existing === undefined) throw new EntityNotFoundError('streaks', kind)
        return streakRepo.update(existing.id, patch)
      }),

    getAchievement: async (key) => (await achievementRepo.findWhere(eq(achievements.key, key)))[0],

    listAchievements: (options) =>
      achievementRepo.findWhere(undefined, { ...options, orderBy: [asc(achievements.key)] }),

    /** Achievements are declared in code and materialize the first time progress is made,
     *  so the first call creates the row and later ones update it. */
    upsertAchievement: async (key, patch) =>
      ctx.run(async () => {
        const existing = (await achievementRepo.findWhere(eq(achievements.key, key)))[0]
        if (existing === undefined) {
          return achievementRepo.create({
            key,
            progress: patch.progress ?? 0,
            target: patch.target ?? 1,
            unlockedAt: patch.unlockedAt ?? null,
            meta: patch.meta ?? null,
          })
        }
        return achievementRepo.update(existing.id, patch)
      }),
  }
}
