import { describe, expect, it } from 'vitest'
import type { KnowledgeItem } from '../entities'
import { createDomainEventBus } from '../events'
import { fakeClock } from '../testing/in-memory-job-repository'
import { createInMemoryReviewStore } from '../testing/in-memory-review-store'
import { cardFixture, knowledgeItemFixture } from '../testing/memory-fixtures'
import { createFsrsScheduler } from './fsrs-scheduler'
import { createReviewCard } from './review-card'
import { createDefaultSchedulingPolicy } from './scheduling-policy'
import { createSeedKnownItems, createUnseedItems, SEED_IMPORTANCE } from './seed-known'
import { createUndoReview } from './session-start'
import { CARD_STATE } from './types'

const START = Date.UTC(2026, 8, 11, 12)

/**
 * `seed_memory` of `docs/spec/04-path-generation.md` §10 step 8, against the real scheduler:
 * one Good through `reviewCard`, with the learning steps skipped the way main wires it, so
 * the acceptance line "seeded cards have exactly one review log with context `diagnostic`"
 * is checked on the actual FSRS arithmetic rather than on a stub.
 */
function harness() {
  const clock = fakeClock(START)
  const store = createInMemoryReviewStore(clock)
  const scheduler = createFsrsScheduler()
  const base = createDefaultSchedulingPolicy()
  const reviewCard = createReviewCard({
    uow: store,
    scheduler,
    policy: {
      optionsFor: async (input) => ({ ...(await base.optionsFor(input)), learningSteps: [] }),
    },
    events: createDomainEventBus(),
    clock,
  })
  const seed = createSeedKnownItems({ repos: store, reviewCard })
  const unseed = createUnseedItems({
    repos: store,
    undoReview: createUndoReview({ uow: store, scheduler, clock }),
  })
  return { clock, store, seed, unseed }
}

let itemCounter = 0

async function lessonItem(
  store: ReturnType<typeof createInMemoryReviewStore>,
  lessonId: string,
  item: Partial<KnowledgeItem> = {},
  cards = 1,
) {
  // The fixtures default to one fixed id each; every item and card here needs its own.
  itemCounter += 1
  const created = await store.knowledgeItems.create(
    knowledgeItemFixture({
      id: `019a0000-0000-7000-8000-${String(itemCounter).padStart(12, '0')}`,
      lessonId,
      status: 'need_to_learn',
      importance: 'high',
      ...item,
    }),
  )
  const made = []
  for (let index = 0; index < cards; index++) {
    // An explicit id per card: the fixture's default is one fixed id, and a second card with
    // it would silently replace the first in the store.
    made.push(
      await store.cards.create(
        cardFixture({
          id: `${created.id}-card-${index}`,
          itemId: created.id,
          state: CARD_STATE.New,
        }),
      ),
    )
  }
  return { item: created, cards: made }
}

describe('createSeedKnownItems', () => {
  it('writes exactly one Good review with context "diagnostic" per never-reviewed card', async () => {
    const { store, seed } = harness()
    const { cards } = await lessonItem(store, 'lesson-1', {}, 2)

    const seeded = await seed({ lessonIds: ['lesson-1'] })

    expect(seeded).toHaveLength(2)
    for (const card of cards) {
      const logs = await store.reviewLogs.listByCard(card.id)
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject({ rating: 3, context: 'diagnostic', state: CARD_STATE.New })
    }
  })

  it('graduates the card straight to Review rather than a learning step', async () => {
    const { store, seed } = harness()
    const { cards } = await lessonItem(store, 'lesson-1')

    await seed({ lessonIds: ['lesson-1'] })

    const stored = await store.cards.findById(cards[0]?.id as string)
    expect(stored?.state).toBe(CARD_STATE.Review)
    expect(stored?.stability).toBeGreaterThan(0)
    expect(stored?.scheduledDays).toBeGreaterThanOrEqual(1)
  })

  it('moves the item out of "Need to Learn" at maintenance importance', async () => {
    const { store, seed } = harness()
    const { item } = await lessonItem(store, 'lesson-1')

    const [record] = await seed({ lessonIds: ['lesson-1'] })

    const stored = await store.knowledgeItems.findById(item.id)
    expect(stored).toMatchObject({ status: 'active', importance: SEED_IMPORTANCE })
    expect(record).toMatchObject({ previousImportance: 'high', previousStatus: 'need_to_learn' })
  })

  it('is idempotent: a second run writes nothing', async () => {
    const { store, seed } = harness()
    const { cards } = await lessonItem(store, 'lesson-1')

    await seed({ lessonIds: ['lesson-1'] })
    const second = await seed({ lessonIds: ['lesson-1'] })

    expect(second).toEqual([])
    expect(await store.reviewLogs.listByCard(cards[0]?.id as string)).toHaveLength(1)
  })

  it('leaves alone a card the learner already reviewed, and archived items', async () => {
    const { store, seed } = harness()
    const studied = await lessonItem(store, 'lesson-1')
    await store.cards.update(studied.cards[0]?.id as string, { state: CARD_STATE.Review })
    await lessonItem(store, 'lesson-1', { status: 'archived' })

    expect(await seed({ lessonIds: ['lesson-1'] })).toEqual([])
    const item = await store.knowledgeItems.findById(studied.item.id)
    expect(item?.importance).toBe('high')
  })

  it('only touches the lessons it is given', async () => {
    const { store, seed } = harness()
    const other = await lessonItem(store, 'lesson-2')

    await seed({ lessonIds: ['lesson-1'] })

    expect(await store.reviewLogs.listByCard(other.cards[0]?.id as string)).toHaveLength(0)
  })
})

describe('createUnseedItems', () => {
  it('rolls every seeded review back and restores the item', async () => {
    const { store, seed, unseed } = harness()
    const { item, cards } = await lessonItem(store, 'lesson-1', {}, 2)
    const seeded = await seed({ lessonIds: ['lesson-1'] })

    expect(await unseed(seeded)).toBe(2)

    for (const card of cards) {
      const stored = await store.cards.findById(card.id)
      expect(stored?.state).toBe(CARD_STATE.New)
      expect(await store.reviewLogs.listByCard(card.id)).toHaveLength(0)
    }
    expect(await store.knowledgeItems.findById(item.id)).toMatchObject({
      status: 'need_to_learn',
      importance: 'high',
    })
  })

  it('counts nothing the second time, which is not an error', async () => {
    const { store, seed, unseed } = harness()
    await lessonItem(store, 'lesson-1')
    const seeded = await seed({ lessonIds: ['lesson-1'] })

    await unseed(seeded)
    expect(await unseed(seeded)).toBe(0)
  })

  it('refuses a seeded card that no longer exists instead of guessing', async () => {
    const { store, unseed } = harness()
    await expect(
      unseed([
        {
          cardId: 'missing-card',
          itemId: 'missing-item',
          logId: 'missing-log',
          previousImportance: 'normal',
          previousStatus: 'need_to_learn',
        },
      ]),
    ).rejects.toThrow()
    expect(store).toBeDefined()
  })
})
