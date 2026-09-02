import type {
  Card,
  CardRepository,
  CardState,
  DueFilters,
  ImportanceCountOptions,
  ImportanceLevel,
  NewEntity,
  SaveEntity,
} from '@retenia/core'
import { IMPORTANCE_LEVELS } from '@retenia/core'
import { and, asc, count, eq, inArray, isNull, lte, ne, type SQL, sql } from 'drizzle-orm'
import { cards, knowledgeItems } from '../schema'
import { type BaseRepository, createBaseRepository, type Row, type TableCodec } from './base'
import type { RepositoryContext } from './context'
import {
  defined,
  fromBool,
  fromDate,
  fromDateOrNull,
  toBool,
  toDate,
  toDateOrNull,
  toJsonObjectOrNull,
  toNumber,
  toText,
  toTextOrNull,
} from './mapping'
import { restoreReviewLogsOfCard, softDeleteReviewLogsOfCard } from './review-logs'

type NewCard = NewEntity<Card>
type CardPatch = Partial<NewCard> & { version?: number }

const codec: TableCodec<Card, NewCard, CardPatch> = {
  table: cards,
  name: 'cards',
  toEntity: (row: Row): Card => ({
    id: toText(row.id),
    itemId: toText(row.itemId),
    template: toText(row.template),
    payload: toJsonObjectOrNull(row.payload),
    due: toDate(row.due),
    stability: toNumber(row.stability),
    difficulty: toNumber(row.difficulty),
    scheduledDays: toNumber(row.scheduledDays),
    learningSteps: toNumber(row.learningSteps),
    reps: toNumber(row.reps),
    lapses: toNumber(row.lapses),
    state: toNumber(row.state) as CardState,
    lastReview: toDateOrNull(row.lastReview),
    suspended: toBool(row.suspended),
    buriedUntil: toDateOrNull(row.buriedUntil),
    leech: toBool(row.leech),
    importanceOverride: toTextOrNull(row.importanceOverride) as ImportanceLevel | null,
    examId: toTextOrNull(row.examId),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    deletedAt: toDateOrNull(row.deletedAt),
    deviceId: toText(row.deviceId),
    version: toNumber(row.version),
  }),
  toInsert: (input) =>
    defined({
      itemId: input.itemId,
      template: input.template,
      payload: input.payload ?? null,
      due: fromDate(input.due),
      stability: input.stability,
      difficulty: input.difficulty,
      scheduledDays: input.scheduledDays,
      learningSteps: input.learningSteps,
      reps: input.reps,
      lapses: input.lapses,
      state: input.state,
      lastReview: fromDateOrNull(input.lastReview),
      suspended: fromBool(input.suspended),
      buriedUntil: fromDateOrNull(input.buriedUntil),
      leech: fromBool(input.leech),
      importanceOverride: input.importanceOverride ?? null,
      examId: input.examId ?? null,
    }),
  toUpdate: (patch) =>
    defined({
      itemId: patch.itemId,
      template: patch.template,
      payload: patch.payload,
      due: patch.due === undefined ? undefined : fromDate(patch.due),
      stability: patch.stability,
      difficulty: patch.difficulty,
      scheduledDays: patch.scheduledDays,
      learningSteps: patch.learningSteps,
      reps: patch.reps,
      lapses: patch.lapses,
      state: patch.state,
      lastReview: patch.lastReview === undefined ? undefined : fromDateOrNull(patch.lastReview),
      suspended: patch.suspended === undefined ? undefined : fromBool(patch.suspended),
      buriedUntil: patch.buriedUntil === undefined ? undefined : fromDateOrNull(patch.buriedUntil),
      leech: patch.leech === undefined ? undefined : fromBool(patch.leech),
      importanceOverride: patch.importanceOverride,
      examId: patch.examId,
    }),
}

/** `cards.importance_override ?? knowledge_items.importance` — the level that actually
 *  governs this card (`docs/spec/02-memory-system.md` §7 rule 1). */
const effectiveImportance = sql<ImportanceLevel>`coalesce(${cards.importanceOverride}, ${knowledgeItems.importance})`

/**
 * The conjuncts of the `cards_due` partial index (`WHERE suspended = 0 AND deleted_at IS
 * NULL`), written with a **literal** 0 rather than `eq(cards.suspended, 0)`.
 *
 * SQLite decides whether a partial index applies at prepare time, by proving each conjunct
 * of the index predicate is implied by the query. `eq()` compiles to `suspended = ?`, whose
 * value is unknown at prepare time, and the proof fails — the index is silently skipped and
 * the daily queue turns into a full scan. `sql` templates only parameterise interpolated
 * values, so the `0` below reaches SQLite as a literal. `repositories.test.ts` pins this
 * with `EXPLAIN QUERY PLAN`.
 */
const liveUnsuspended = sql`${cards.suspended} = 0 and ${cards.deletedAt} is null`

/**
 * Everything that makes a card eligible.
 *
 * Beyond the obvious (due, not suspended, not buried), two conditions come from the item:
 * a card whose item was soft-deleted must disappear with it (nothing cascades that in
 * SQL), and only an `active` item is in the queue at all — `need_to_learn` means
 * "generated but not scheduled" and `archived` means "out of the queue for good".
 */
function duePredicate(nowMs: number, filters: DueFilters): SQL | undefined {
  const predicates: Array<SQL | undefined> = [
    liveUnsuspended,
    lte(cards.due, nowMs),
    sql`(${cards.buriedUntil} is null or ${cards.buriedUntil} <= ${nowMs})`,
    isNull(knowledgeItems.deletedAt),
    eq(knowledgeItems.status, 'active'),
  ]
  if (filters.includePaused !== true) predicates.push(ne(effectiveImportance, 'paused'))
  if (filters.importance !== undefined) {
    predicates.push(inArray(effectiveImportance, [...filters.importance]))
  }
  if (filters.states !== undefined) predicates.push(inArray(cards.state, [...filters.states]))
  if (filters.examId !== undefined) {
    predicates.push(
      filters.examId === null ? isNull(cards.examId) : eq(cards.examId, filters.examId),
    )
  }
  return and(...predicates)
}

/**
 * The `findDue` query itself, split out so `sqlite.test.ts` can run `EXPLAIN QUERY PLAN`
 * over the exact SQL the repository executes rather than over a copy that could drift.
 */
export function buildFindDueQuery(ctx: RepositoryContext, now: Date, filters: DueFilters = {}) {
  const query = ctx.db
    .select({ card: cards })
    .from(cards)
    .innerJoin(knowledgeItems, eq(cards.itemId, knowledgeItems.id))
    .where(duePredicate(now.getTime(), filters))
    .orderBy(asc(cards.due), asc(cards.id))
    .$dynamic()
  return filters.limit === undefined ? query : query.limit(filters.limit)
}

export function createCardRepository(ctx: RepositoryContext): CardRepository {
  const base: BaseRepository<Card, NewCard, CardPatch> = createBaseRepository(ctx, codec)

  function countPredicate(options: ImportanceCountOptions): SQL | undefined {
    const predicates: Array<SQL | undefined> = [
      isNull(cards.deletedAt),
      isNull(knowledgeItems.deletedAt),
    ]
    if (options.includeSuspended !== true) predicates.push(sql`${cards.suspended} = 0`)
    if (options.dueBefore !== undefined) {
      const at = options.dueBefore.getTime()
      predicates.push(lte(cards.due, at))
      if (options.includeBuried !== true) {
        predicates.push(sql`(${cards.buriedUntil} is null or ${cards.buriedUntil} <= ${at})`)
      }
    }
    return and(...predicates)
  }

  return {
    findById: base.findById,
    findMany: base.findMany,
    list: base.list,
    count: base.count,
    create: base.create,
    update: base.update,
    save: base.save,
    restore: async (id) => {
      await ctx.run(async () => {
        const deleted = await base.findById(id, { includeDeleted: true })
        await base.restore(id)
        if (deleted?.deletedAt != null) {
          restoreReviewLogsOfCard(ctx, id, deleted.deletedAt.getTime())
        }
      })
    },
    /** Takes the card's review history with it. There is no trigger for this cascade — the
     *  only ones in the schema are `sources → source_units/chunks` and the FTS/vec sync —
     *  so the repository owns it, in one transaction. */
    softDelete: async (id) => {
      await ctx.run(async () => {
        const at = ctx.clock.now().getTime()
        await base.softDelete(id)
        softDeleteReviewLogsOfCard(ctx, id, at)
      })
    },

    findByItem: (itemId, options) =>
      base.findWhere(eq(cards.itemId, itemId), {
        ...options,
        orderBy: [asc(cards.template), asc(cards.id)],
      }),

    listByExam: (examId, options) =>
      base.findWhere(eq(cards.examId, examId), {
        ...options,
        orderBy: [asc(cards.due), asc(cards.id)],
      }),

    /**
     * Due candidates, `due` ascending — index order, with the id as a deterministic
     * tie-break. Deliberately *not* the queue order of `docs/spec/02-memory-system.md` §12:
     * sorting by importance rank would throw away the index-ordered scan, and the rest of
     * that order (relearning interleave, new-item quota, sibling dispersion, final drill) is
     * domain logic the daily session composer owns in sub-phase 4.3.
     */
    findDue: async (now, filters = {}) => {
      const rows = buildFindDueQuery(ctx, now, filters).all() as Array<{ card: Row }>
      return rows.map((row) => codec.toEntity(row.card))
    },

    countByImportance: async (options = {}) => {
      const rows = ctx.db
        .select({ importance: effectiveImportance, value: count() })
        .from(cards)
        .innerJoin(knowledgeItems, eq(cards.itemId, knowledgeItems.id))
        .where(countPredicate(options))
        .groupBy(effectiveImportance)
        .all() as Array<{ importance: ImportanceLevel; value: number }>
      // Always total: every level present, zeroes included, so no caller handles undefined.
      const totals = Object.fromEntries(IMPORTANCE_LEVELS.map((level) => [level, 0])) as Record<
        ImportanceLevel,
        number
      >
      for (const row of rows) totals[row.importance] = row.value
      return totals
    },

    bulkSave: async (batch: readonly SaveEntity<Card>[]) => {
      if (batch.length === 0) return
      await ctx.run(async () => {
        for (const card of batch) await base.save(card)
      })
    },

    setSuspended: (id, suspended) => base.updateColumns(id, { suspended: fromBool(suspended) }),
    buryUntil: (id, until) => base.updateColumns(id, { buriedUntil: fromDateOrNull(until) }),
    setLeech: (id, leech) => base.updateColumns(id, { leech: fromBool(leech) }),
  }
}
