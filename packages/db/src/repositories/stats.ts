import type {
  CardMemoryState,
  CardState,
  ImportanceLevel,
  Rating,
  ReviewContext,
  ReviewEvent,
  StatsRepository,
} from '@retenia/core'
import { and, asc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import { cards, knowledgeItems, reviewLogs } from '../schema'
import type { RepositoryContext } from './context'
import { toDate, toDateOrNull, toNumber, toNumberOrNull, toText, toTextOrNull } from './mapping'

/**
 * The two joined projections behind `docs/spec/02-memory-system.md` §13's statistics.
 *
 * Both carry the card's **effective** importance — its unexpired override, falling back to
 * its item's level (§7 rule 1) — because §13's second row compares desired against true
 * retention *per level*, and every other row is broken down by level on the screen. Doing
 * that join here rather than in `packages/core` is the difference between two queries and
 * one per review.
 *
 * The `case` below is `cards.ts`'s `effectiveImportanceAt`, repeated rather than shared:
 * that one is a module-private helper of the card repository bound to its own `nowMs`, and
 * exporting it would make an internal of the queue's hot path part of two tables' contract.
 * `stats.test.ts` pins the two against each other.
 */
function effectiveImportanceAt(nowMs: number) {
  return sql<ImportanceLevel>`coalesce(
    case
      when ${cards.importanceOverrideExpiresAt} is null
        or ${cards.importanceOverrideExpiresAt} > ${nowMs}
      then ${cards.importanceOverride}
    end,
    ${knowledgeItems.importance}
  )`
}

/** Live everywhere the statistics look: the log, its card and the card's item. */
const liveChain = sql`${reviewLogs.deletedAt} is null
  and ${cards.deletedAt} is null
  and ${knowledgeItems.deletedAt} is null`

export function createStatsRepository(ctx: RepositoryContext): StatsRepository {
  return {
    listReviewEvents: async (from, to, options = {}) => {
      const at = ctx.clock.now().getTime()
      const level = effectiveImportanceAt(at)
      const query = ctx.db
        .select({
          cardId: reviewLogs.cardId,
          level,
          rating: reviewLogs.rating,
          state: reviewLogs.state,
          scheduledDays: reviewLogs.scheduledDays,
          stability: reviewLogs.stability,
          difficulty: reviewLogs.difficulty,
          due: reviewLogs.due,
          review: reviewLogs.review,
          durationMs: reviewLogs.durationMs,
          context: reviewLogs.context,
          activityType: reviewLogs.activityType,
        })
        .from(reviewLogs)
        .innerJoin(cards, eq(reviewLogs.cardId, cards.id))
        .innerJoin(knowledgeItems, eq(cards.itemId, knowledgeItems.id))
        .where(
          and(
            liveChain,
            gte(reviewLogs.review, from.getTime()),
            lt(reviewLogs.review, to.getTime()),
          ),
        )
        // Oldest first, then by id: `firstOfDay` takes the first row it sees for a
        // (card, day) pair, so the order is part of the contract, not a convenience.
        .orderBy(asc(reviewLogs.review), asc(reviewLogs.id))
        .$dynamic()

      const rows = (
        options.limit === undefined ? query : query.limit(options.limit)
      ).all() as Array<Record<string, unknown>>

      return rows.map(
        (row): ReviewEvent => ({
          cardId: toText(row.cardId),
          level: toText(row.level) as ImportanceLevel,
          rating: toNumber(row.rating) as Rating,
          state: toNumber(row.state) as CardState,
          scheduledDays: toNumber(row.scheduledDays),
          stability: toNumber(row.stability),
          difficulty: toNumber(row.difficulty),
          due: toDate(row.due),
          review: toDate(row.review),
          durationMs: toNumberOrNull(row.durationMs),
          context: toText(row.context) as ReviewContext,
          activityType: toTextOrNull(row.activityType),
        }),
      )
    },

    listMemoryStates: async (options = {}) => {
      const at = ctx.clock.now().getTime()
      const level = effectiveImportanceAt(at)
      const query = ctx.db
        .select({
          cardId: cards.id,
          level,
          state: cards.state,
          stability: cards.stability,
          difficulty: cards.difficulty,
          due: cards.due,
          lastReview: cards.lastReview,
        })
        .from(cards)
        .innerJoin(knowledgeItems, eq(cards.itemId, knowledgeItems.id))
        .where(
          and(
            sql`${cards.suspended} = 0`,
            isNull(cards.deletedAt),
            isNull(knowledgeItems.deletedAt),
            // `need_to_learn` items are generated but never scheduled, so there is no
            // memory of them to count; `archived` ones are out of the collection.
            eq(knowledgeItems.status, 'active'),
          ),
        )
        .orderBy(asc(cards.id))
        .$dynamic()

      const rows = (
        options.limit === undefined ? query : query.limit(options.limit)
      ).all() as Array<Record<string, unknown>>

      return rows.map(
        (row): CardMemoryState => ({
          cardId: toText(row.cardId),
          level: toText(row.level) as ImportanceLevel,
          state: toNumber(row.state) as CardState,
          stability: toNumber(row.stability),
          difficulty: toNumber(row.difficulty),
          due: toDate(row.due),
          lastReview: toDateOrNull(row.lastReview),
        }),
      )
    },
  }
}
