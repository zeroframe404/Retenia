import type { Card, ImportanceLevel, KnowledgeItem, ReviewLog, ReviewSession } from '../entities'
import { type ActivityPace, foldPace } from '../memory/pace'
import type { ActivityStatsRepository } from '../ports/activity-stats-repository'
import type { EntityPatch, FindOptions, ListOptions, NewEntity } from '../ports/audit'
import type { CardRepository, DueFilters, DueProjection } from '../ports/card-repository'
import type { Clock } from '../ports/clock'
import { EntityNotFoundError, OptimisticConcurrencyError } from '../ports/errors'
import type { KnowledgeItemRepository } from '../ports/knowledge-item-repository'
import type { ReviewLogRepository } from '../ports/review-log-repository'
import type { ReviewSessionRepository } from '../ports/review-session-repository'

/**
 * An in-memory unit of work over the slice of the repositories the memory-system use cases
 * touch — `reviewCard`, urgent mode and reschedule —
 * so the use case can be tested in `packages/core`, which by rule cannot reach the SQLite
 * adapter (`tooling/scripts/check-deps.mjs`). `packages/db` proves the real repositories
 * against the shared contracts; this double only reproduces what the use case leans on:
 * `findById`, an `update` that honours the optimistic `version` token, an append-only
 * log, and a transaction that really rolls its writes back.
 */

/**
 * Everything the memory-system use cases call, in one bag. Written out rather than composed
 * from their `…UnitOfWork` types: each of those narrows `cards` differently, and the store
 * is structurally assignable to all of them anyway.
 */
export interface StoreRepositories {
  activityStats: ActivityStatsRepository
  cards: Pick<
    CardRepository,
    | 'findById'
    | 'findMany'
    | 'list'
    | 'listByItems'
    | 'findDue'
    | 'listDueBetween'
    | 'update'
    | 'buryUntil'
    | 'overrideImportance'
    | 'clearExpiredOverrides'
  >
  knowledgeItems: Pick<KnowledgeItemRepository, 'findById' | 'findMany'>
  reviewLogs: Pick<
    ReviewLogRepository,
    'append' | 'findById' | 'listSince' | 'medianDurationMs' | 'softDeleteById'
  >
  reviewSessions: Pick<
    ReviewSessionRepository,
    'create' | 'update' | 'findById' | 'findActive' | 'abandonStale' | 'listSince'
  >
}

export interface InMemoryReviewStore extends StoreRepositories {
  cards: StoreRepositories['cards'] & {
    create(input: NewEntity<Card>): Promise<Card>
    all(): Card[]
  }
  knowledgeItems: StoreRepositories['knowledgeItems'] & {
    create(input: NewEntity<KnowledgeItem>): Promise<KnowledgeItem>
  }
  reviewLogs: StoreRepositories['reviewLogs'] & {
    listByCard(cardId: string): Promise<ReviewLog[]>
    all(): ReviewLog[]
  }
  reviewSessions: StoreRepositories['reviewSessions'] & {
    all(): ReviewSession[]
  }
  transaction<T>(work: (repos: InMemoryReviewStore) => Promise<T> | T): Promise<T>
  /** Every `append` call, including those a rolled-back transaction discarded. */
  readonly appendCalls: number
  /** Every `update` call, including those a rolled-back transaction discarded. */
  readonly updateCalls: number
}

export function createInMemoryReviewStore(
  clock: Clock,
  options: { deviceId?: string } = {},
): InMemoryReviewStore {
  const deviceId = options.deviceId ?? 'test-device'
  let cards = new Map<string, Card>()
  let items = new Map<string, KnowledgeItem>()
  let logs = new Map<string, ReviewLog>()
  let sessions = new Map<string, ReviewSession>()
  let pace = new Map<string, ActivityPace>()
  let sequence = 0
  let appendCalls = 0
  let updateCalls = 0
  let depth = 0

  const nextId = (): string => {
    sequence += 1
    return `00000000-0000-7000-8000-${String(sequence).padStart(12, '0')}`
  }

  const audit = () => {
    const now = clock.now()
    return { createdAt: now, updatedAt: now, deletedAt: null, deviceId, version: 1 }
  }

  const applyList = <T>(rows: T[], listOptions?: ListOptions): T[] => {
    const from = listOptions?.offset ?? 0
    return listOptions?.limit === undefined
      ? rows.slice(from)
      : rows.slice(from, from + listOptions.limit)
  }

  const live = <T extends { deletedAt: Date | null }>(
    row: T | undefined,
    findOptions?: FindOptions,
  ): T | undefined =>
    row !== undefined && (row.deletedAt === null || findOptions?.includeDeleted === true)
      ? row
      : undefined

  /** `card.importanceOverride` while it is still in force, else the item's level — the
   *  adapter's `effectiveImportanceAt`, in memory. */
  const effectiveLevel = (
    card: Card,
    item: KnowledgeItem | undefined,
    now: Date,
  ): ImportanceLevel => {
    const expires = card.importanceOverrideExpiresAt
    const live_ = expires === null || expires.getTime() > now.getTime()
    if (card.importanceOverride !== null && live_) return card.importanceOverride
    return item?.importance ?? 'normal'
  }

  const liveCards = (): Card[] =>
    [...cards.values()]
      .filter((card) => card.deletedAt === null)
      .sort((a, b) => a.id.localeCompare(b.id))

  const repos: StoreRepositories = {
    cards: {
      findById: async (id, findOptions) => live(cards.get(id), findOptions),
      findMany: async (ids, findOptions) =>
        ids.map((id) => live(cards.get(id), findOptions)).filter((card) => card !== undefined),
      list: async (listOptions?: ListOptions) => applyList(liveCards(), listOptions),
      listByItems: async (itemIds, listOptions) =>
        applyList(
          liveCards().filter((card) => itemIds.includes(card.itemId)),
          listOptions,
        ),
      /**
       * The real adapter's predicate, in memory: live, unsuspended, burial expired, item
       * active, `paused` out unless asked for, and filtered on the *effective* importance
       * (a lapsed override does not count). Ordered by `due` then id, exactly as the
       * adapter's `cards_due` scan is — the composer does its own level ordering on top.
       */
      findDue: async (now, filters: DueFilters = {}) => {
        const at = now.getTime()
        const rows = liveCards()
          .filter((card) => {
            if (card.suspended) return false
            if (card.due.getTime() > at) return false
            if (card.buriedUntil !== null && card.buriedUntil.getTime() > at) return false
            const item = live(items.get(card.itemId))
            if (item === undefined || item.status !== 'active') return false
            const level = effectiveLevel(card, item, now)
            if (filters.includePaused !== true && level === 'paused') return false
            if (filters.importance !== undefined && !filters.importance.includes(level))
              return false
            if (filters.states !== undefined && !filters.states.includes(card.state)) return false
            if (filters.examId !== undefined) {
              if (filters.examId === null ? card.examId !== null : card.examId !== filters.examId) {
                return false
              }
            }
            return true
          })
          .sort((a, b) => a.due.getTime() - b.due.getTime() || a.id.localeCompare(b.id))
        return filters.limit === undefined ? rows : rows.slice(0, filters.limit)
      },
      listDueBetween: async (from, to, listDueOptions = {}) => {
        const now = clock.now()
        const rows = liveCards()
          .filter((card) => {
            if (card.suspended) return false
            const due = card.due.getTime()
            if (due < from.getTime() || due >= to.getTime()) return false
            const item = live(items.get(card.itemId))
            if (item === undefined || item.status !== 'active') return false
            return effectiveLevel(card, item, now) !== 'paused'
          })
          .sort((a, b) => a.due.getTime() - b.due.getTime() || a.id.localeCompare(b.id))
          .map(
            (card): DueProjection => ({
              due: card.due,
              level: effectiveLevel(card, live(items.get(card.itemId)), now),
              state: card.state,
            }),
          )
        return listDueOptions.limit === undefined ? rows : rows.slice(0, listDueOptions.limit)
      },
      buryUntil: async (id, until) => {
        const card = live(cards.get(id))
        if (card === undefined) throw new EntityNotFoundError('cards', id)
        const next: Card = {
          ...card,
          buriedUntil: until,
          updatedAt: clock.now(),
          version: card.version + 1,
        }
        cards.set(id, next)
        return next
      },
      overrideImportance: async (
        ids: readonly string[],
        level: ImportanceLevel | null,
        expiresAt: Date | null = null,
      ) => {
        let written = 0
        for (const id of ids) {
          const card = live(cards.get(id))
          if (card === undefined) continue
          cards.set(id, {
            ...card,
            importanceOverride: level,
            importanceOverrideExpiresAt: level === null ? null : expiresAt,
            updatedAt: clock.now(),
            version: card.version + 1,
          })
          written += 1
        }
        return written
      },
      clearExpiredOverrides: async (now) => {
        let cleared = 0
        for (const card of liveCards()) {
          const at = card.importanceOverrideExpiresAt
          if (at === null || at.getTime() > now.getTime()) continue
          cards.set(card.id, {
            ...card,
            importanceOverride: null,
            importanceOverrideExpiresAt: null,
            updatedAt: clock.now(),
            version: card.version + 1,
          })
          cleared += 1
        }
        return cleared
      },
      update: async (id, patch: EntityPatch<Card>) => {
        updateCalls += 1
        const card = live(cards.get(id))
        if (card === undefined) throw new EntityNotFoundError('cards', id)
        if (patch.version !== undefined && patch.version !== card.version) {
          throw new OptimisticConcurrencyError('cards', id, patch.version, card.version)
        }
        const { version: _token, ...fields } = patch
        const next: Card = {
          ...card,
          ...(fields as Partial<Card>),
          updatedAt: clock.now(),
          version: card.version + 1,
        }
        cards.set(id, next)
        return next
      },
    },
    knowledgeItems: {
      findById: async (id, findOptions) => live(items.get(id), findOptions),
      findMany: async (ids, findOptions) =>
        ids.map((id) => live(items.get(id), findOptions)).filter((item) => item !== undefined),
    },
    activityStats: {
      find: async (activityType) => pace.get(activityType),
      list: async () =>
        [...pace.values()].sort((a, b) => a.activityType.localeCompare(b.activityType)),
      medianMs: async (activityType) => pace.get(activityType)?.medianMs ?? null,
      record: async (activityType, durationMs) => {
        const next = foldPace(pace.get(activityType), activityType, durationMs)
        pace.set(activityType, next)
        return next
      },
    },
    reviewLogs: {
      append: async (input) => {
        appendCalls += 1
        const log: ReviewLog = { ...input, id: input.id ?? nextId(), ...audit() }
        logs.set(log.id, log)
        return log
      },
      findById: async (id) => logs.get(id),
      listSince: async (from, to, listOptions) =>
        applyList(
          [...logs.values()]
            .filter(
              (log) =>
                log.deletedAt === null &&
                log.review.getTime() >= from.getTime() &&
                (to === undefined || log.review.getTime() < to.getTime()),
            )
            .sort((a, b) => a.review.getTime() - b.review.getTime() || a.id.localeCompare(b.id)),
          listOptions,
        ),
      /** The lower of the two middle values, like the adapter's `LIMIT 1 OFFSET n/2`.
       *  Rating `Manual` and zero durations are excluded there too. */
      medianDurationMs: async (medianOptions = {}) => {
        const durations = [...logs.values()]
          .filter((log) => {
            if (log.deletedAt !== null) return false
            if (log.rating === 0) return false
            if (log.durationMs === null || log.durationMs <= 0) return false
            if (medianOptions.from !== undefined && log.review < medianOptions.from) return false
            if (
              medianOptions.contexts !== undefined &&
              !medianOptions.contexts.includes(log.context)
            ) {
              return false
            }
            return true
          })
          .map((log) => log.durationMs as number)
          .sort((a, b) => a - b)
        if (durations.length === 0) return null
        return durations[Math.floor((durations.length - 1) / 2)] as number
      },
      /** Sets `deletedAt` only — `updatedAt` and `version` stay put, which is the one
       *  mutation the append-only rule permits. */
      softDeleteById: async (id, deletedAt) => {
        const log = logs.get(id)
        if (log === undefined || log.deletedAt !== null) return false
        logs.set(id, { ...log, deletedAt })
        return true
      },
    },
    reviewSessions: {
      create: async (input) => {
        const session: ReviewSession = { ...input, id: input.id ?? nextId(), ...audit() }
        sessions.set(session.id, session)
        return session
      },
      update: async (id, patch: EntityPatch<ReviewSession>) => {
        const session = live(sessions.get(id))
        if (session === undefined) throw new EntityNotFoundError('review_sessions', id)
        if (patch.version !== undefined && patch.version !== session.version) {
          throw new OptimisticConcurrencyError(
            'review_sessions',
            id,
            patch.version,
            session.version,
          )
        }
        const { version: _token, ...fields } = patch
        const next: ReviewSession = {
          ...session,
          ...(fields as Partial<ReviewSession>),
          updatedAt: clock.now(),
          version: session.version + 1,
        }
        sessions.set(id, next)
        return next
      },
      findById: async (id, findOptions) => live(sessions.get(id), findOptions),
      findActive: async () =>
        [...sessions.values()]
          .filter((session) => session.deletedAt === null && session.status === 'in_progress')
          .sort(
            (a, b) => b.startedAt.getTime() - a.startedAt.getTime() || b.id.localeCompare(a.id),
          )[0],
      abandonStale: async (before) => {
        let closed = 0
        for (const session of [...sessions.values()]) {
          if (session.deletedAt !== null || session.status !== 'in_progress') continue
          if (session.startedAt.getTime() >= before.getTime()) continue
          sessions.set(session.id, {
            ...session,
            status: 'abandoned',
            updatedAt: clock.now(),
            version: session.version + 1,
          })
          closed += 1
        }
        return closed
      },
      listSince: async (from, to, listOptions) =>
        applyList(
          [...sessions.values()]
            .filter(
              (session) =>
                session.deletedAt === null &&
                session.startedAt.getTime() >= from.getTime() &&
                (to === undefined || session.startedAt.getTime() < to.getTime()),
            )
            .sort(
              (a, b) => b.startedAt.getTime() - a.startedAt.getTime() || b.id.localeCompare(a.id),
            ),
          listOptions,
        ),
    },
  }

  const store: InMemoryReviewStore = {
    ...repos,
    cards: {
      ...repos.cards,
      create: async (input) => {
        const card: Card = { ...input, id: input.id ?? nextId(), ...audit() }
        cards.set(card.id, card)
        return card
      },
      all: () => [...cards.values()],
    },
    knowledgeItems: {
      ...repos.knowledgeItems,
      create: async (input) => {
        const item: KnowledgeItem = { ...input, id: input.id ?? nextId(), ...audit() }
        items.set(item.id, item)
        return item
      },
    },
    reviewLogs: {
      ...repos.reviewLogs,
      listByCard: async (cardId) =>
        [...logs.values()]
          .filter((log) => log.cardId === cardId && log.deletedAt === null)
          .sort((a, b) => a.review.getTime() - b.review.getTime() || a.id.localeCompare(b.id)),
      all: () => [...logs.values()],
    },
    reviewSessions: {
      ...repos.reviewSessions,
      all: () => [...sessions.values()],
    },
    get appendCalls() {
      return appendCalls
    },
    get updateCalls() {
      return updateCalls
    },
    transaction: async (work) => {
      // The work gets the store itself (a stubbed method is seen inside the transaction
      // too). Nested calls join the outer transaction, as the SQLite adapter's savepoints
      // do for the cases this double is used in.
      if (depth > 0) return work(store)
      const snapshot = {
        cards: new Map(cards),
        items: new Map(items),
        logs: new Map(logs),
        sessions: new Map(sessions),
        pace: new Map(pace),
      }
      depth = 1
      try {
        return await work(store)
      } catch (error) {
        cards = snapshot.cards
        items = snapshot.items
        logs = snapshot.logs
        sessions = snapshot.sessions
        pace = snapshot.pace
        throw error
      } finally {
        depth = 0
      }
    },
  }
  return store
}
