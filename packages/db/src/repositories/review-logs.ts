import type {
  CardState,
  ListOptions,
  NewEntity,
  Rating,
  ReviewContext,
  ReviewLog,
  ReviewLogRepository,
} from '@retenia/core'
import { and, asc, count, desc, eq, gte, isNull, lt, type SQL } from 'drizzle-orm'
import { reviewLogs } from '../schema'
import type { Row } from './base'
import { auditValues, type RepositoryContext } from './context'
import { mapConstraintErrors } from './errors'
import { toDate, toDateOrNull, toNumber, toNumberOrNull, toText, toTextOrNull } from './mapping'

/**
 * The FSRS history — append-only.
 *
 * There is no `update` and no `save` here on purpose: a rewritten review would corrupt the
 * optimizer's training set and make `rollback` unsound. The schema says the same thing
 * (`CHECK (updated_at = created_at AND version = 1)`), so this repository does not build on
 * `createBaseRepository` at all — its update path would bump `version` and every write
 * would fail at the database.
 */

function toEntity(row: Row): ReviewLog {
  return {
    id: toText(row.id),
    cardId: toText(row.cardId),
    rating: toNumber(row.rating) as Rating,
    state: toNumber(row.state) as CardState,
    due: toDate(row.due),
    stability: toNumber(row.stability),
    difficulty: toNumber(row.difficulty),
    elapsedDays: toNumber(row.elapsedDays),
    scheduledDays: toNumber(row.scheduledDays),
    learningSteps: toNumber(row.learningSteps),
    review: toDate(row.review),
    durationMs: toNumberOrNull(row.durationMs),
    context: row.context as ReviewContext,
    exerciseScore: toNumberOrNull(row.exerciseScore),
    device: toTextOrNull(row.device),
    attemptId: toTextOrNull(row.attemptId),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }
}

/**
 * Internal: the `deleted_at`-only cascade `CardRepository.softDelete` performs.
 *
 * Sets **only** `deleted_at` — no `updated_at`, no `version` bump — because that is the one
 * mutation `review_logs_append_only` (`updated_at = created_at AND version = 1`) still
 * allows. Not on the port, and not exported from `@retenia/db`.
 */
export function softDeleteReviewLogsOfCard(
  ctx: RepositoryContext,
  cardId: string,
  at: number,
): number {
  const rows = ctx.db
    .update(reviewLogs)
    .set({ deletedAt: at })
    .where(and(eq(reviewLogs.cardId, cardId), isNull(reviewLogs.deletedAt)))
    .returning({ id: reviewLogs.id, version: reviewLogs.version })
    .all() as Array<{ id: string; version: number }>
  for (const row of rows) ctx.outbox.append('delete', 'review_logs', row)
  return rows.length
}

/** The mirror image: restores exactly the logs the cascade took, the way
 *  `sources_undelete_cascade` does for chunks. */
export function restoreReviewLogsOfCard(
  ctx: RepositoryContext,
  cardId: string,
  deletedAt: number,
): number {
  const rows = ctx.db
    .update(reviewLogs)
    .set({ deletedAt: null })
    .where(and(eq(reviewLogs.cardId, cardId), eq(reviewLogs.deletedAt, deletedAt)))
    .returning({ id: reviewLogs.id, version: reviewLogs.version })
    .all() as Array<{ id: string; version: number }>
  for (const row of rows) ctx.outbox.append('update', 'review_logs', row)
  return rows.length
}

export function createReviewLogRepository(ctx: RepositoryContext): ReviewLogRepository {
  function insert(input: NewEntity<ReviewLog>, at: number): ReviewLog {
    const rows = mapConstraintErrors('review_logs', () =>
      ctx.db
        .insert(reviewLogs)
        .values({
          id: input.id ?? ctx.ids.next(),
          cardId: input.cardId,
          rating: input.rating,
          state: input.state,
          due: input.due.getTime(),
          stability: input.stability,
          difficulty: input.difficulty,
          elapsedDays: input.elapsedDays,
          scheduledDays: input.scheduledDays,
          learningSteps: input.learningSteps,
          review: input.review.getTime(),
          durationMs: input.durationMs ?? null,
          context: input.context,
          exerciseScore: input.exerciseScore ?? null,
          device: input.device ?? null,
          attemptId: input.attemptId ?? null,
          ...auditValues(ctx, at),
        })
        .returning()
        .all(),
    ) as Row[]
    const row = rows[0]
    if (row === undefined) throw new Error('review_logs: insert returned no row')
    ctx.outbox.append('insert', 'review_logs', {
      id: toText(row.id),
      version: toNumber(row.version),
    })
    return toEntity(row)
  }

  function select(
    where: SQL | undefined,
    options: ListOptions | undefined,
    order: SQL[],
  ): ReviewLog[] {
    let query = ctx.db.select().from(reviewLogs).$dynamic()
    const predicate =
      options?.includeDeleted === true ? where : and(where, isNull(reviewLogs.deletedAt))
    if (predicate !== undefined) query = query.where(predicate)
    query = query.orderBy(...order)
    if (options?.limit !== undefined) query = query.limit(options.limit)
    if (options?.offset !== undefined) query = query.offset(options.offset)
    return (query.all() as Row[]).map(toEntity)
  }

  return {
    append: async (input) => insert(input, ctx.clock.now().getTime()),

    appendMany: async (inputs) => {
      if (inputs.length === 0) return []
      return ctx.run(async () => {
        const at = ctx.clock.now().getTime()
        return inputs.map((input) => insert(input, at))
      })
    },

    findById: async (id) => select(eq(reviewLogs.id, id), undefined, [asc(reviewLogs.review)])[0],

    listByCard: async (cardId, options) =>
      select(eq(reviewLogs.cardId, cardId), options, [asc(reviewLogs.review), asc(reviewLogs.id)]),

    listSince: async (from, to, options) =>
      select(
        and(
          gte(reviewLogs.review, from.getTime()),
          to === undefined ? undefined : lt(reviewLogs.review, to.getTime()),
        ),
        options,
        [asc(reviewLogs.review), asc(reviewLogs.id)],
      ),

    findLastByCard: async (cardId) =>
      select(eq(reviewLogs.cardId, cardId), { limit: 1 }, [
        desc(reviewLogs.review),
        desc(reviewLogs.id),
      ])[0],

    countByCard: async (cardId) => {
      const rows = ctx.db
        .select({ value: count() })
        .from(reviewLogs)
        .where(and(eq(reviewLogs.cardId, cardId), isNull(reviewLogs.deletedAt)))
        .all() as Array<{ value: number }>
      return rows[0]?.value ?? 0
    },

    softDeleteForCard: async (cardId, deletedAt) =>
      softDeleteReviewLogsOfCard(ctx, cardId, deletedAt.getTime()),
  }
}
