import type { Attempt, AttemptRepository, LessonSession, NewEntity, Rating } from '@retenia/core'
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, max } from 'drizzle-orm'
import { attempts, lessonSessions } from '../schema'
import { createBaseRepository, type Row, type TableCodec } from './base'
import type { RepositoryContext } from './context'
import {
  defined,
  fromBoolOrNull,
  toBoolOrNull,
  toDate,
  toDateOrNull,
  toJsonObjectOrNull,
  toJsonValueOrNull,
  toNumber,
  toNumberOrNull,
  toText,
  toTextOrNull,
} from './mapping'

const attemptCodec: TableCodec<
  Attempt,
  NewEntity<Attempt>,
  Partial<NewEntity<Attempt>> & { version?: number }
> = {
  table: attempts,
  name: 'attempts',
  toEntity: (row: Row): Attempt => ({
    id: toText(row.id),
    activityId: toText(row.activityId),
    context: row.context as Attempt['context'],
    mode: row.mode as Attempt['mode'],
    lessonSessionId: toTextOrNull(row.lessonSessionId),
    reviewSessionId: toTextOrNull(row.reviewSessionId),
    examAttemptId: toTextOrNull(row.examAttemptId),
    cardId: toTextOrNull(row.cardId),
    startedAt: toDate(row.startedAt),
    finishedAt: toDateOrNull(row.finishedAt),
    score: toNumberOrNull(row.score),
    correct: toBoolOrNull(row.correct),
    rating: toNumberOrNull(row.rating) as Rating | null,
    answer: toJsonValueOrNull(row.answer),
    feedback: toJsonValueOrNull(row.feedback),
    timeMs: toNumberOrNull(row.timeMs),
    tries: toNumber(row.tries),
    hintsUsed: toNumber(row.hintsUsed),
    confidence: toTextOrNull(row.confidence) as Attempt['confidence'],
    aiEvalCallId: toTextOrNull(row.aiEvalCallId),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      activityId: input.activityId,
      context: input.context,
      mode: input.mode,
      lessonSessionId: input.lessonSessionId ?? null,
      reviewSessionId: input.reviewSessionId ?? null,
      examAttemptId: input.examAttemptId ?? null,
      cardId: input.cardId ?? null,
      startedAt: input.startedAt.getTime(),
      finishedAt:
        input.finishedAt === null || input.finishedAt === undefined
          ? null
          : input.finishedAt.getTime(),
      score: input.score ?? null,
      correct: fromBoolOrNull(input.correct),
      rating: input.rating ?? null,
      answer: input.answer ?? null,
      feedback: input.feedback ?? null,
      timeMs: input.timeMs ?? null,
      tries: input.tries,
      hintsUsed: input.hintsUsed,
      confidence: input.confidence ?? null,
      aiEvalCallId: input.aiEvalCallId ?? null,
    }),
  toUpdate: (patch) =>
    defined({
      activityId: patch.activityId,
      context: patch.context,
      mode: patch.mode,
      lessonSessionId: patch.lessonSessionId,
      reviewSessionId: patch.reviewSessionId,
      examAttemptId: patch.examAttemptId,
      cardId: patch.cardId,
      startedAt: patch.startedAt === undefined ? undefined : patch.startedAt.getTime(),
      finishedAt:
        patch.finishedAt === undefined ? undefined : (patch.finishedAt?.getTime() ?? null),
      score: patch.score,
      correct: patch.correct === undefined ? undefined : fromBoolOrNull(patch.correct),
      rating: patch.rating,
      answer: patch.answer,
      feedback: patch.feedback,
      timeMs: patch.timeMs,
      tries: patch.tries,
      hintsUsed: patch.hintsUsed,
      confidence: patch.confidence,
      aiEvalCallId: patch.aiEvalCallId,
    }),
}

const sessionCodec: TableCodec<
  LessonSession,
  NewEntity<LessonSession>,
  Partial<NewEntity<LessonSession>> & { version?: number }
> = {
  table: lessonSessions,
  name: 'lesson_sessions',
  toEntity: (row: Row): LessonSession => ({
    id: toText(row.id),
    lessonId: toText(row.lessonId),
    status: row.status as LessonSession['status'],
    startedAt: toDate(row.startedAt),
    finishedAt: toDateOrNull(row.finishedAt),
    durationMs: toNumberOrNull(row.durationMs),
    xp: toNumber(row.xp),
    accuracy: toNumberOrNull(row.accuracy),
    activitiesTotal: toNumber(row.activitiesTotal),
    activitiesCorrect: toNumber(row.activitiesCorrect),
    summary: toJsonObjectOrNull(row.summary),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      lessonId: input.lessonId,
      status: input.status,
      startedAt: input.startedAt.getTime(),
      finishedAt:
        input.finishedAt === null || input.finishedAt === undefined
          ? null
          : input.finishedAt.getTime(),
      durationMs: input.durationMs ?? null,
      xp: input.xp,
      accuracy: input.accuracy ?? null,
      activitiesTotal: input.activitiesTotal,
      activitiesCorrect: input.activitiesCorrect,
      summary: input.summary ?? null,
    }),
  toUpdate: (patch) =>
    defined({
      status: patch.status,
      startedAt: patch.startedAt === undefined ? undefined : patch.startedAt.getTime(),
      finishedAt:
        patch.finishedAt === undefined ? undefined : (patch.finishedAt?.getTime() ?? null),
      durationMs: patch.durationMs,
      xp: patch.xp,
      accuracy: patch.accuracy,
      activitiesTotal: patch.activitiesTotal,
      activitiesCorrect: patch.activitiesCorrect,
      summary: patch.summary,
    }),
}

export function createAttemptRepository(ctx: RepositoryContext): AttemptRepository {
  const base = createBaseRepository(ctx, attemptCodec)
  const sessions = createBaseRepository(ctx, sessionCodec)
  const byStart = [asc(attempts.startedAt), asc(attempts.id)]

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

    listByCard: (cardId, options) =>
      base.findWhere(eq(attempts.cardId, cardId), { ...options, orderBy: byStart }),
    listBySession: (lessonSessionId, options) =>
      base.findWhere(eq(attempts.lessonSessionId, lessonSessionId), {
        ...options,
        orderBy: byStart,
      }),
    listByExamAttempt: (examAttemptId, options) =>
      base.findWhere(eq(attempts.examAttemptId, examAttemptId), { ...options, orderBy: byStart }),
    listByActivity: (activityId, options) =>
      base.findWhere(eq(attempts.activityId, activityId), { ...options, orderBy: byStart }),
    listByReviewSession: (reviewSessionId, options) =>
      base.findWhere(eq(attempts.reviewSessionId, reviewSessionId), {
        ...options,
        orderBy: byStart,
      }),

    lastServedAt: async (activityIds) => {
      const found = new Map<string, Date>()
      if (activityIds.length === 0) return found
      const rows = await ctx.db
        .select({
          activityId: attempts.activityId,
          lastServedAt: max(attempts.startedAt),
        })
        .from(attempts)
        .where(
          and(
            inArray(attempts.activityId, [...activityIds]),
            isNull(attempts.deletedAt),
            // Finished attempts only. The attempt row is opened when an activity is *shown*,
            // so counting open ones would let a skipped card — or a session the user walked
            // away from — suppress that activity for a week without the learner ever having
            // answered it. "Last served" is about what they actually did.
            isNotNull(attempts.finishedAt),
          ),
        )
        .groupBy(attempts.activityId)
      for (const row of rows) {
        if (row.lastServedAt === null) continue
        found.set(row.activityId, new Date(Number(row.lastServedAt)))
      }
      return found
    },
    listSince: (from, to, options) =>
      base.findWhere(
        and(
          gte(attempts.startedAt, from.getTime()),
          to === undefined ? undefined : lt(attempts.startedAt, to.getTime()),
        ),
        { ...options, orderBy: byStart },
      ),

    findSession: sessions.findById,
    listSessions: (lessonId, options) =>
      sessions.findWhere(eq(lessonSessions.lessonId, lessonId), {
        ...options,
        orderBy: [asc(lessonSessions.startedAt), asc(lessonSessions.id)],
      }),
    createSession: sessions.create,
    updateSession: sessions.update,
  }
}
