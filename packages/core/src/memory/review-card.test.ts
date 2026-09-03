import { describe, expect, it, vi } from 'vitest'
import type { Card, KnowledgeItem } from '../entities'
import { createDomainEventBus } from '../events'
import type { DomainEvent } from '../ports/domain-events'
import { EntityNotFoundError, OptimisticConcurrencyError } from '../ports/errors'
import { fakeClock } from '../testing/in-memory-job-repository'
import {
  createInMemoryReviewStore,
  type InMemoryReviewStore,
} from '../testing/in-memory-review-store'
import { cardFixture, knowledgeItemFixture } from '../testing/memory-fixtures'
import { createFsrsScheduler } from './fsrs-scheduler'
import { DEFAULT_SCHEDULING_OPTIONS } from './parameters'
import { createReviewCard, type ReviewCardDeps } from './review-card'
import { createDefaultSchedulingPolicy, type SchedulingPolicy } from './scheduling-policy'
import { DAY_MS } from './study-day'

const START = Date.UTC(2026, 5, 1, 12)

function harness(overrides: Partial<ReviewCardDeps> = {}) {
  const clock = fakeClock(START)
  const store: InMemoryReviewStore = createInMemoryReviewStore(clock)
  const events = createDomainEventBus()
  const published: DomainEvent[] = []
  events.subscribeAll((event) => published.push(event))
  const deps: ReviewCardDeps = {
    uow: store,
    scheduler: createFsrsScheduler(),
    policy: createDefaultSchedulingPolicy(),
    events,
    clock,
    ...overrides,
  }
  return { clock, store, events, published, reviewCard: createReviewCard(deps), deps }
}

async function seed(
  store: InMemoryReviewStore,
  card: Partial<Card> = {},
  item: Partial<KnowledgeItem> = {},
): Promise<Card> {
  const created = await store.knowledgeItems.create(knowledgeItemFixture(item))
  return store.cards.create(cardFixture({ itemId: created.id, ...card }))
}

describe('reviewCard', () => {
  it('writes exactly one log and the updated card, then publishes card.reviewed', async () => {
    const { store, reviewCard, published, clock } = harness()
    const card = await seed(store)
    const now = clock.now()

    const result = await reviewCard({
      cardId: card.id,
      rating: 3,
      durationMs: 4200,
      exerciseScore: 0.95,
      device: 'win32',
      attemptId: 'attempt-1',
    })

    expect(store.appendCalls).toBe(1)
    expect(store.updateCalls).toBe(1)
    const logs = await store.reviewLogs.listByCard(card.id)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      cardId: card.id,
      rating: 3,
      state: 0,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      review: now,
      durationMs: 4200,
      context: 'daily',
      exerciseScore: 0.95,
      device: 'win32',
      attemptId: 'attempt-1',
      algorithmVersion: 'fsrs6',
      version: 1,
    })
    const stored = await store.cards.findById(card.id)
    expect(stored).toMatchObject({
      state: 1,
      learningSteps: 1,
      reps: 1,
      version: 2,
      lastReview: now,
    })
    expect(stored?.stability).toBeGreaterThan(0)
    expect(result.card).toEqual(stored)
    expect(result.log).toEqual(logs[0])
    expect(result.previous).toMatchObject({ state: 0, stability: 0, reps: 0, lastReview: null })
    expect(result.options).toEqual(DEFAULT_SCHEDULING_OPTIONS)

    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({
      type: 'card.reviewed',
      card: stored,
      log: logs[0],
      previous: result.previous,
      retrievabilityBefore: 0,
      options: DEFAULT_SCHEDULING_OPTIONS,
    })
  })

  it('takes the review time from the clock and the context from the rating when not given', async () => {
    const { store, reviewCard, clock } = harness()
    const card = await seed(store)
    clock.advance(5 * DAY_MS)
    const first = await reviewCard({ cardId: card.id, rating: 4 })
    expect(first.log.review).toEqual(clock.now())
    expect(first.log.context).toBe('daily')
    expect(first.log.durationMs).toBeNull()
    expect(first.log.exerciseScore).toBeNull()
    expect(first.log.device).toBeNull()
    expect(first.log.attemptId).toBeNull()

    const explicit = new Date(clock.now().getTime() + 10 * DAY_MS)
    const second = await reviewCard({
      cardId: card.id,
      rating: 3,
      now: explicit,
      context: 'exam_sim',
    })
    expect(second.log.review).toEqual(explicit)
    expect(second.log.context).toBe('exam_sim')
    expect(second.log.elapsedDays).toBe(10)
    expect(second.previous.state).toBe(2)
    expect(second.card.version).toBe(3)
    expect(await store.reviewLogs.listByCard(card.id)).toHaveLength(2)
  })

  it('logs a postpone with rating Manual, leaving S, D and the last review untouched', async () => {
    const { store, reviewCard, published, clock } = harness()
    const card = await seed(store, {
      state: 2,
      stability: 9,
      difficulty: 4,
      scheduledDays: 9,
      reps: 3,
      lastReview: new Date(START - 9 * DAY_MS),
      due: new Date(START),
    })
    const due = new Date(START + 4 * DAY_MS)
    const result = await reviewCard({ cardId: card.id, rating: 0, due })

    expect(result.card).toMatchObject({
      due,
      scheduledDays: 4,
      stability: 9,
      difficulty: 4,
      reps: 3,
      lastReview: card.lastReview,
      version: 2,
    })
    expect(result.log).toMatchObject({
      rating: 0,
      context: 'manual_postpone',
      elapsedDays: 9,
      review: clock.now(),
    })
    expect(store.appendCalls).toBe(1)
    expect(published[0]).toMatchObject({ type: 'card.reviewed', log: { rating: 0 } })
    expect((published[0] as { retrievabilityBefore: number }).retrievabilityBefore).toBeCloseTo(
      0.9,
      12,
    )
  })

  it('rejects malformed input before reading anything', async () => {
    const { store, reviewCard } = harness()
    const card = await seed(store)
    await expect(reviewCard({ cardId: card.id, rating: 5 as never })).rejects.toThrow(/rating/)
    await expect(reviewCard({ cardId: card.id, rating: 3, now: new Date('x') })).rejects.toThrow(
      TypeError,
    )
    await expect(reviewCard({ cardId: card.id, rating: 3, durationMs: -1 })).rejects.toThrow(
      /durationMs/,
    )
    await expect(reviewCard({ cardId: card.id, rating: 3, exerciseScore: 1.5 })).rejects.toThrow(
      /exerciseScore/,
    )
    await expect(
      reviewCard({ cardId: card.id, rating: 3, context: 'bogus' as never }),
    ).rejects.toThrow(/context/)
    await expect(reviewCard({ cardId: card.id, rating: 3, device: 7 as never })).rejects.toThrow(
      TypeError,
    )
    await expect(
      reviewCard({ cardId: card.id, rating: 0, due: undefined as never }),
    ).rejects.toThrow(/due/)
    expect(store.appendCalls).toBe(0)
    expect(store.updateCalls).toBe(0)
  })

  it('fails with EntityNotFoundError for an unknown card, writing nothing', async () => {
    const { store, reviewCard, published } = harness()
    await expect(reviewCard({ cardId: 'missing', rating: 3 })).rejects.toBeInstanceOf(
      EntityNotFoundError,
    )
    expect(store.appendCalls).toBe(0)
    expect(published).toHaveLength(0)
  })

  it('hands the policy the card, its item (or null) and the review time', async () => {
    const optionsFor = vi.fn(async () => ({
      ...DEFAULT_SCHEDULING_OPTIONS,
      desiredRetention: 0.95,
    }))
    const policy: SchedulingPolicy = { optionsFor }
    const { store, reviewCard, clock } = harness({ policy })
    const card = await seed(store, {}, { importance: 'urgent' })
    const result = await reviewCard({ cardId: card.id, rating: 3 })
    expect(optionsFor).toHaveBeenCalledWith({
      card,
      item: expect.objectContaining({ importance: 'urgent' }),
      now: clock.now(),
    })
    expect(result.options.desiredRetention).toBe(0.95)

    const orphan = await store.cards.create(
      cardFixture({ id: '019a0000-0000-7000-8000-00000000dddd', itemId: 'gone' }),
    )
    await reviewCard({ cardId: orphan.id, rating: 3 })
    expect(optionsFor).toHaveBeenLastCalledWith({ card: orphan, item: null, now: clock.now() })
  })

  it('rolls the whole write back when the card moved on under it', async () => {
    // The policy stands in for a concurrent writer: it bumps the card while the review
    // holds the stale version.
    const { store, published, deps } = harness()
    const card = await seed(store)
    deps.policy = {
      optionsFor: async () => {
        await store.cards.update(card.id, { suspended: true })
        return DEFAULT_SCHEDULING_OPTIONS
      },
    }
    const racing = createReviewCard(deps)
    await expect(racing({ cardId: card.id, rating: 3 })).rejects.toBeInstanceOf(
      OptimisticConcurrencyError,
    )
    expect(store.appendCalls).toBe(0)
    expect(await store.reviewLogs.listByCard(card.id)).toHaveLength(0)
    expect((await store.cards.findById(card.id))?.state).toBe(0)
    expect(published).toHaveLength(0)
  })

  it('rolls the card update back when the log cannot be appended', async () => {
    const { store, reviewCard, published } = harness()
    const card = await seed(store)
    const append = store.reviewLogs.append
    store.reviewLogs.append = async () => {
      throw new Error('disk full')
    }
    await expect(reviewCard({ cardId: card.id, rating: 3 })).rejects.toThrow('disk full')
    store.reviewLogs.append = append
    expect((await store.cards.findById(card.id))?.version).toBe(1)
    expect(published).toHaveLength(0)
  })

  it('publishes only after the transaction committed, so a listener sees the row', async () => {
    const { store, reviewCard, events } = harness()
    const card = await seed(store)
    let seen = 0
    events.subscribe('card.reviewed', () => {
      seen = store.reviewLogs.all().length
    })
    await reviewCard({ cardId: card.id, rating: 3 })
    expect(seen).toBe(1)
  })

  it('uses the system clock when none is injected', async () => {
    const { store, deps } = harness()
    const card = await seed(store)
    const { clock: _clock, ...withoutClock } = deps
    const before = Date.now()
    const result = await createReviewCard(withoutClock)({ cardId: card.id, rating: 3 })
    expect(result.log.review.getTime()).toBeGreaterThanOrEqual(before)
    expect(result.log.review.getTime()).toBeLessThanOrEqual(Date.now())
  })
})
