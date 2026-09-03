import type { Card, KnowledgeItem, ReviewLog } from '../entities'
import type { ReviewRepositories, ReviewUnitOfWork } from '../memory/review-card'
import type { EntityPatch, FindOptions, NewEntity } from '../ports/audit'
import type { Clock } from '../ports/clock'
import { EntityNotFoundError, OptimisticConcurrencyError } from '../ports/errors'

/**
 * An in-memory `ReviewUnitOfWork` — the slice of the repositories `reviewCard` touches —
 * so the use case can be tested in `packages/core`, which by rule cannot reach the SQLite
 * adapter (`tooling/scripts/check-deps.mjs`). `packages/db` proves the real repositories
 * against the shared contracts; this double only reproduces what the use case leans on:
 * `findById`, an `update` that honours the optimistic `version` token, an append-only
 * log, and a transaction that really rolls its writes back.
 */

export interface InMemoryReviewStore extends ReviewUnitOfWork {
  cards: ReviewRepositories['cards'] & {
    create(input: NewEntity<Card>): Promise<Card>
    all(): Card[]
  }
  knowledgeItems: ReviewRepositories['knowledgeItems'] & {
    create(input: NewEntity<KnowledgeItem>): Promise<KnowledgeItem>
  }
  reviewLogs: ReviewRepositories['reviewLogs'] & {
    listByCard(cardId: string): Promise<ReviewLog[]>
    all(): ReviewLog[]
  }
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

  const live = <T extends { deletedAt: Date | null }>(
    row: T | undefined,
    findOptions?: FindOptions,
  ): T | undefined =>
    row !== undefined && (row.deletedAt === null || findOptions?.includeDeleted === true)
      ? row
      : undefined

  const repos: ReviewRepositories = {
    cards: {
      findById: async (id, findOptions) => live(cards.get(id), findOptions),
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
    },
    reviewLogs: {
      append: async (input) => {
        appendCalls += 1
        const log: ReviewLog = { ...input, id: input.id ?? nextId(), ...audit() }
        logs.set(log.id, log)
        return log
      },
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
      const snapshot = { cards: new Map(cards), items: new Map(items), logs: new Map(logs) }
      depth = 1
      try {
        return await work(store)
      } catch (error) {
        cards = snapshot.cards
        items = snapshot.items
        logs = snapshot.logs
        throw error
      } finally {
        depth = 0
      }
    },
  }
  return store
}
