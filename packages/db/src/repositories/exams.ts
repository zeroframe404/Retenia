import type {
  Exam,
  ExamAttempt,
  ExamItem,
  ExamRepository,
  ItemBankEntry,
  ItemBankRepository,
  NewEntity,
} from '@retenia/core'
import { and, asc, eq, gte, inArray, isNull, like, sql } from 'drizzle-orm'
import { examAttempts, examItems, exams, itemBank } from '../schema'
import { createBaseRepository, type Row, type TableCodec } from './base'
import type { RepositoryContext } from './context'
import {
  defined,
  fromBool,
  toBool,
  toDate,
  toDateOrNull,
  toJsonArray,
  toJsonObject,
  toNumber,
  toNumberOrNull,
  toText,
  toTextOrNull,
} from './mapping'

const examCodec: TableCodec<
  Exam,
  NewEntity<Exam>,
  Partial<NewEntity<Exam>> & { version?: number }
> = {
  table: exams,
  name: 'exams',
  toEntity: (row: Row): Exam => ({
    id: toText(row.id),
    title: toText(row.title),
    kind: row.kind as Exam['kind'],
    date: toTextOrNull(row.date),
    pathId: toTextOrNull(row.pathId),
    scope: toJsonObject(row.scope),
    blueprint: toJsonArray(row.blueprint),
    targetRetention: toNumber(row.targetRetention),
    finalWindowDays: toNumber(row.finalWindowDays),
    studyDaysMask: toNumber(row.studyDaysMask),
    dailyCapacityMinutes: toNumberOrNull(row.dailyCapacityMinutes),
    status: row.status as Exam['status'],
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      title: input.title,
      kind: input.kind,
      date: input.date ?? null,
      pathId: input.pathId ?? null,
      scope: input.scope,
      blueprint: input.blueprint,
      targetRetention: input.targetRetention,
      finalWindowDays: input.finalWindowDays,
      studyDaysMask: input.studyDaysMask,
      dailyCapacityMinutes: input.dailyCapacityMinutes ?? null,
      status: input.status,
    }),
  toUpdate: (patch) =>
    defined({
      title: patch.title,
      kind: patch.kind,
      date: patch.date,
      pathId: patch.pathId,
      scope: patch.scope,
      blueprint: patch.blueprint,
      targetRetention: patch.targetRetention,
      finalWindowDays: patch.finalWindowDays,
      studyDaysMask: patch.studyDaysMask,
      dailyCapacityMinutes: patch.dailyCapacityMinutes,
      status: patch.status,
    }),
}

const examItemCodec: TableCodec<
  ExamItem,
  NewEntity<ExamItem>,
  Partial<NewEntity<ExamItem>> & { version?: number }
> = {
  table: examItems,
  name: 'exam_items',
  toEntity: (row: Row): ExamItem => ({
    id: toText(row.id),
    examId: toText(row.examId),
    ordinal: toNumber(row.ordinal),
    activityId: toText(row.activityId),
    itemBankId: toTextOrNull(row.itemBankId),
    form: toTextOrNull(row.form) as ExamItem['form'],
    topic: toTextOrNull(row.topic),
    weight: toNumber(row.weight),
    timeLimitSec: toNumberOrNull(row.timeLimitSec),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      examId: input.examId,
      ordinal: input.ordinal,
      activityId: input.activityId,
      itemBankId: input.itemBankId ?? null,
      form: input.form ?? null,
      topic: input.topic ?? null,
      weight: input.weight,
      timeLimitSec: input.timeLimitSec ?? null,
    }),
  toUpdate: (patch) =>
    defined({
      ordinal: patch.ordinal,
      activityId: patch.activityId,
      itemBankId: patch.itemBankId,
      form: patch.form,
      topic: patch.topic,
      weight: patch.weight,
      timeLimitSec: patch.timeLimitSec,
    }),
}

const examAttemptCodec: TableCodec<
  ExamAttempt,
  NewEntity<ExamAttempt>,
  Partial<NewEntity<ExamAttempt>> & { version?: number }
> = {
  table: examAttempts,
  name: 'exam_attempts',
  toEntity: (row: Row): ExamAttempt => ({
    id: toText(row.id),
    examId: toText(row.examId),
    mode: row.mode as ExamAttempt['mode'],
    startedAt: toDate(row.startedAt),
    finishedAt: toDateOrNull(row.finishedAt),
    score: toNumberOrNull(row.score),
    byTopic: toJsonObject(row.byTopic),
    items: toJsonArray(row.items),
    readinessPredicted: toNumberOrNull(row.readinessPredicted),
    affectsScheduling: toBool(row.affectsScheduling),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      examId: input.examId,
      mode: input.mode,
      startedAt: input.startedAt.getTime(),
      finishedAt:
        input.finishedAt === null || input.finishedAt === undefined
          ? null
          : input.finishedAt.getTime(),
      score: input.score ?? null,
      byTopic: input.byTopic,
      items: input.items,
      readinessPredicted: input.readinessPredicted ?? null,
      affectsScheduling: fromBool(input.affectsScheduling),
    }),
  toUpdate: (patch) =>
    defined({
      mode: patch.mode,
      startedAt: patch.startedAt === undefined ? undefined : patch.startedAt.getTime(),
      finishedAt:
        patch.finishedAt === undefined ? undefined : (patch.finishedAt?.getTime() ?? null),
      score: patch.score,
      byTopic: patch.byTopic,
      items: patch.items,
      readinessPredicted: patch.readinessPredicted,
      affectsScheduling:
        patch.affectsScheduling === undefined ? undefined : fromBool(patch.affectsScheduling),
    }),
}

const itemBankCodec: TableCodec<
  ItemBankEntry,
  NewEntity<ItemBankEntry>,
  Partial<NewEntity<ItemBankEntry>> & { version?: number }
> = {
  table: itemBank,
  name: 'item_bank',
  toEntity: (row: Row): ItemBankEntry => ({
    id: toText(row.id),
    activityId: toText(row.activityId),
    pathVersionId: toTextOrNull(row.pathVersionId),
    moduleId: toTextOrNull(row.moduleId),
    usage: (row.usage ?? []) as ItemBankEntry['usage'],
    difficultyLogit: toNumber(row.difficultyLogit),
    discriminationHint: toNumberOrNull(row.discriminationHint),
    exposure: toNumber(row.exposure),
    stats: toJsonObject(row.stats),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      activityId: input.activityId,
      pathVersionId: input.pathVersionId ?? null,
      moduleId: input.moduleId ?? null,
      usage: input.usage,
      difficultyLogit: input.difficultyLogit,
      discriminationHint: input.discriminationHint ?? null,
      exposure: input.exposure,
      stats: input.stats,
    }),
  toUpdate: (patch) =>
    defined({
      activityId: patch.activityId,
      pathVersionId: patch.pathVersionId,
      moduleId: patch.moduleId,
      usage: patch.usage,
      difficultyLogit: patch.difficultyLogit,
      discriminationHint: patch.discriminationHint,
      exposure: patch.exposure,
      stats: patch.stats,
    }),
}

export function createExamRepository(ctx: RepositoryContext): ExamRepository {
  const base = createBaseRepository(ctx, examCodec)
  const items = createBaseRepository(ctx, examItemCodec)
  const attempts = createBaseRepository(ctx, examAttemptCodec)

  return {
    findById: base.findById,
    findMany: base.findMany,
    list: base.list,
    count: base.count,
    create: base.create,
    update: base.update,
    save: base.save,
    softDelete: base.softDelete,
    restore: base.restore,

    listByStatus: (status, options) =>
      base.findWhere(eq(exams.status, status), {
        ...options,
        orderBy: [asc(exams.date), asc(exams.id)],
      }),

    listByPath: (pathId, options) =>
      base.findWhere(eq(exams.pathId, pathId), {
        ...options,
        orderBy: [asc(exams.date), asc(exams.id)],
      }),

    /** `exams.date` is an ISO `YYYY-MM-DD` string, so a lexical comparison is a date
     *  comparison — no parsing, and the `exams_status_date` index still applies. */
    listUpcoming: (from, options) =>
      base.findWhere(and(sql`${exams.date} is not null`, gte(exams.date, toIsoDay(from))), {
        ...options,
        orderBy: [asc(exams.date), asc(exams.id)],
      }),

    listItems: (examId, options) =>
      items.findWhere(eq(examItems.examId, examId), {
        ...options,
        orderBy: [asc(examItems.ordinal), asc(examItems.id)],
      }),

    createItems: items.createMany,

    replaceItems: async (examId, replacements) =>
      ctx.run(async () => {
        const existing = await items.findWhere(eq(examItems.examId, examId))
        for (const item of existing) await items.softDelete(item.id)
        return items.createMany(replacements.map((item) => ({ ...item, examId })))
      }),

    findAttempt: attempts.findById,

    listAttempts: (examId, options) =>
      attempts.findWhere(eq(examAttempts.examId, examId), {
        ...options,
        orderBy: [asc(examAttempts.startedAt), asc(examAttempts.id)],
      }),

    startAttempt: attempts.create,
    updateAttempt: attempts.update,
  }
}

/** `Date` → the ISO `YYYY-MM-DD` string the `date` columns hold, in UTC. */
function toIsoDay(at: Date): string {
  return at.toISOString().slice(0, 10)
}

export function createItemBankRepository(ctx: RepositoryContext): ItemBankRepository {
  const base = createBaseRepository(ctx, itemBankCodec)

  return {
    findById: base.findById,
    findMany: base.findMany,
    list: base.list,
    count: base.count,
    create: base.create,
    update: base.update,
    save: base.save,
    softDelete: base.softDelete,
    restore: base.restore,

    findByActivity: async (activityId) =>
      (await base.findWhere(eq(itemBank.activityId, activityId)))[0],

    listByModule: (moduleId, options) =>
      base.findWhere(eq(itemBank.moduleId, moduleId), {
        ...options,
        orderBy: [asc(itemBank.difficultyLogit), asc(itemBank.id)],
      }),

    listByPathVersion: (pathVersionId, options) =>
      base.findWhere(eq(itemBank.pathVersionId, pathVersionId), {
        ...options,
        orderBy: [asc(itemBank.difficultyLogit), asc(itemBank.id)],
      }),

    /** `usage` is a JSON array in a TEXT column; `like` over the serialised form is the
     *  cheap containment test at v1 volumes. Least-exposed first, so a mock exam does not
     *  keep serving the same items. */
    listByUsage: (pathVersionId, usage, options) =>
      base.findWhere(
        and(eq(itemBank.pathVersionId, pathVersionId), like(itemBank.usage, `%"${usage}"%`)),
        { ...options, orderBy: [asc(itemBank.exposure), asc(itemBank.id)] },
      ),

    bumpExposure: async (ids) => {
      if (ids.length === 0) return
      await ctx.run(async () => {
        const rows = ctx.db
          .update(itemBank)
          .set({
            exposure: sql`${itemBank.exposure} + 1`,
            updatedAt: sql`max(${itemBank.updatedAt}, ${ctx.clock.now().getTime()})`,
            deviceId: ctx.deviceId,
            version: sql`${itemBank.version} + 1`,
          })
          .where(and(inArray(itemBank.id, [...ids]), isNull(itemBank.deletedAt)))
          .returning({ id: itemBank.id, version: itemBank.version })
          .all() as Array<{ id: string; version: number }>
        for (const row of rows) ctx.outbox.append('update', 'item_bank', row)
      })
    },
  }
}
