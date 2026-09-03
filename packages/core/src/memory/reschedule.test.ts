import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card, ImportanceLevel } from '../entities'
import { fakeClock } from '../testing/in-memory-job-repository'
import {
  createInMemoryReviewStore,
  type InMemoryReviewStore,
} from '../testing/in-memory-review-store'
import { cardFixture, knowledgeItemFixture } from '../testing/memory-fixtures'
import { intervalForRetention } from './formulas'
import { createFsrsScheduler } from './fsrs-scheduler'
import {
  createRescheduleNow,
  createSimulateReschedule,
  DEFAULT_RESCHEDULE_LIMIT,
  projectReschedule,
} from './reschedule'
import { createImportanceResolver } from './scheduling-policy'
import { DAY_MS } from './study-day'
import { CARD_STATE, RATING } from './types'

const NOW = new Date('2026-03-05T08:00:00.000Z')
const LAST_REVIEW = new Date('2026-02-03T08:00:00.000Z')
const scheduler = createFsrsScheduler()
const resolve = createImportanceResolver()

function mature(overrides: Partial<Card> = {}): Card {
  return cardFixture({
    state: CARD_STATE.Review,
    stability: 30,
    difficulty: 5,
    reps: 4,
    scheduledDays: 30,
    lastReview: LAST_REVIEW,
    due: new Date(LAST_REVIEW.getTime() + 30 * DAY_MS),
    ...overrides,
  })
}

function candidate(card: Card, level: ImportanceLevel = 'normal') {
  return {
    card,
    resolution: resolve({ card, item: knowledgeItemFixture({ importance: level }), now: NOW }),
  }
}

describe('projectReschedule', () => {
  it('recomputes the interval from the card’s current stability, at the new retention', () => {
    // Maintenance asks 0.85 rather than Normal's 0.90, so the same S = 30 buys more days.
    const impact = projectReschedule([candidate(mature(), 'maintenance')], NOW, scheduler)
    const expected = Math.round(intervalForRetention(0.85, 30))

    expect(impact.affected).toBe(1)
    expect(impact.changes[0]).toMatchObject({
      currentIntervalDays: 30,
      newIntervalDays: expected,
      desiredRetention: 0.85,
    })
    expect(expected).toBeGreaterThan(30)
  })

  /** Anchoring at `now` would silently push every overdue card forward. */
  it('anchors the new due date at the last review, not at `now`', () => {
    const impact = projectReschedule([candidate(mature(), 'urgent')], NOW, scheduler)
    const change = impact.changes[0]
    expect(change?.newDue).toEqual(
      new Date(LAST_REVIEW.getTime() + (change?.newIntervalDays as number) * DAY_MS),
    )
    // Urgent's 0.95 shortens the interval, so the card comes forward — into the past here,
    // which is exactly "due now".
    expect(change?.deltaDays).toBeLessThan(0)
    expect(change?.newDue.getTime()).toBeLessThan(NOW.getTime())
  })

  it('honours the level’s interval cap', () => {
    // Urgent caps at 180 days; S = 4000 at DR 0.85 would otherwise ask for far more.
    const impact = projectReschedule(
      [candidate(mature({ stability: 4000 }), 'urgent')],
      NOW,
      scheduler,
    )
    expect(impact.changes[0]?.newIntervalDays).toBe(180)
  })

  it('never books less than a day', () => {
    const impact = projectReschedule(
      [candidate(mature({ stability: 0.01 }), 'urgent')],
      NOW,
      scheduler,
    )
    expect(impact.changes[0]?.newIntervalDays).toBe(1)
  })

  it('skips cards with no long-term interval to recompute, and says why', () => {
    const impact = projectReschedule(
      [
        candidate(cardFixture()), // New
        candidate(mature({ state: CARD_STATE.Learning })),
        candidate(mature({ stability: 0 })),
        candidate(mature({ lastReview: null })),
      ],
      NOW,
      scheduler,
    )
    expect(impact.affected).toBe(0)
    expect(impact.skipped).toEqual({ notInReview: 2, noMemoryState: 2, unchanged: 0 })
  })

  it('counts a card projected onto the day it already sits on as unchanged', () => {
    const card = mature()
    // Normal is the level the card is already scheduled at, so nothing moves.
    const impact = projectReschedule([candidate(card, 'normal')], NOW, scheduler)
    expect(impact.affected).toBe(0)
    expect(impact.skipped.unchanged).toBe(1)
  })

  it('reports the due-in-7-days and reviews-a-day deltas', () => {
    const soon = mature({ due: new Date(NOW.getTime() + 3 * DAY_MS) })
    const impact = projectReschedule([candidate(soon, 'maintenance')], NOW, scheduler)

    expect(impact.dueInSevenDays.before).toBe(1)
    expect(impact.dueInSevenDays.after).toBe(0)
    expect(impact.dueInSevenDays.delta).toBe(-1)
    // A longer interval is a lighter steady-state load.
    expect(impact.reviewsPerDay.after).toBeLessThan(impact.reviewsPerDay.before)
    expect(impact.reviewsPerDay.delta).toBeCloseTo(
      impact.reviewsPerDay.after - impact.reviewsPerDay.before,
      12,
    )
  })

  it('counts a card moving *into* the seven-day window too', () => {
    // Due in a month, but urgent's 0.95 pulls it forward to within the week.
    const far = mature({ due: new Date(NOW.getTime() + 30 * DAY_MS) })
    const impact = projectReschedule([candidate(far, 'urgent')], NOW, scheduler)
    expect(impact.dueInSevenDays).toEqual({ before: 0, after: 1, delta: 1 })
    expect(impact.byLevel.urgent.dueInSevenDaysDelta).toBe(1)
  })

  it('breaks the counts down by level', () => {
    const impact = projectReschedule(
      [candidate(mature({ id: 'a' }), 'urgent'), candidate(mature({ id: 'b' }), 'maintenance')],
      NOW,
      scheduler,
    )
    expect(impact.byLevel.urgent.affected).toBe(1)
    expect(impact.byLevel.maintenance.affected).toBe(1)
    expect(impact.byLevel.high.affected).toBe(0)
  })

  it('is empty, not broken, with nothing to project', () => {
    const impact = projectReschedule([], NOW, scheduler)
    expect(impact).toMatchObject({
      affected: 0,
      changes: [],
      dueInSevenDays: { before: 0, after: 0, delta: 0 },
      computedAt: NOW,
    })
  })
})

describe('createSimulateReschedule / createRescheduleNow', () => {
  let clock: ReturnType<typeof fakeClock>
  let store: InMemoryReviewStore
  let itemId: string
  let cardId: string

  beforeEach(async () => {
    clock = fakeClock(NOW.getTime())
    store = createInMemoryReviewStore(clock)
    const item = await store.knowledgeItems.create(
      knowledgeItemFixture({ id: undefined, importance: 'maintenance' }),
    )
    itemId = item.id
    const card = await store.cards.create(mature({ id: undefined, itemId }))
    cardId = card.id
  })

  const simulate = () => createSimulateReschedule({ repos: store, resolve, scheduler, clock })
  const apply = () => createRescheduleNow({ uow: store, resolve, scheduler, clock })

  /**
   * The acceptance criterion: a simulation writes nothing. It is structural too — the
   * `repos` slice `createSimulateReschedule` takes carries no write method at all — but
   * the counters prove it at run time.
   */
  it('writes nothing at all', async () => {
    const before = JSON.stringify({ cards: store.cards.all(), logs: store.reviewLogs.all() })
    const impact = await simulate()()

    expect(impact.affected).toBe(1)
    expect(store.updateCalls).toBe(0)
    expect(store.appendCalls).toBe(0)
    expect(JSON.stringify({ cards: store.cards.all(), logs: store.reviewLogs.all() })).toBe(before)
  })

  it('selects by card id, by item id, or takes everything', async () => {
    expect((await simulate()({ cardIds: [cardId] })).affected).toBe(1)
    expect((await simulate()({ itemIds: [itemId] })).affected).toBe(1)
    expect((await simulate()({ cardIds: ['nobody'] })).affected).toBe(0)
    expect((await simulate()({})).affected).toBe(1)
  })

  it('filters by effective level', async () => {
    expect((await simulate()({ levels: ['maintenance'] })).affected).toBe(1)
    expect((await simulate()({ levels: ['urgent'] })).affected).toBe(0)
  })

  it('leaves suspended and paused cards out', async () => {
    await store.cards.update(cardId, { suspended: true })
    expect((await simulate()()).affected).toBe(0)

    await store.cards.update(cardId, { suspended: false })
    await store.cards.overrideImportance([cardId], 'paused')
    expect((await simulate()()).affected).toBe(0)
  })

  /**
   * Every field of the selection is optional, so `{}` is a legal call. Without a default
   * it would mean "every live card" — one synchronous read of the whole table, and for the
   * apply half a transaction writing four rows per card.
   */
  it('bounds an unnarrowed selection rather than loading the whole table', async () => {
    const list = vi.spyOn(store.cards, 'list')
    await simulate()()
    expect(list).toHaveBeenCalledWith({ limit: DEFAULT_RESCHEDULE_LIMIT })

    await simulate()({ limit: 5 })
    expect(list).toHaveBeenLastCalledWith({ limit: 5 })
    list.mockRestore()
  })

  it('bounds an item-scoped selection too', async () => {
    const byItems = vi.spyOn(store.cards, 'listByItems')
    await simulate()({ itemIds: [itemId] })
    expect(byItems).toHaveBeenCalledWith([itemId], { limit: DEFAULT_RESCHEDULE_LIMIT })
    byItems.mockRestore()
  })

  it('takes an explicit `now` over the clock', async () => {
    const now = new Date('2026-04-01T00:00:00.000Z')
    expect((await simulate()({ now })).computedAt).toEqual(now)
  })

  it('falls back to the system clock when it was given none', async () => {
    const before = Date.now()
    const impact = await createSimulateReschedule({ repos: store, resolve, scheduler })()
    expect(impact.computedAt.getTime()).toBeGreaterThanOrEqual(before)
    // The same for the apply half — with a selection that matches nothing, so the wall
    // clock never reaches the database.
    const { applied } = await createRescheduleNow({ uow: store, resolve, scheduler })({
      cardIds: ['nobody'],
      confirm: true,
    })
    expect(applied).toBe(0)
  })

  /** A card outlives the source it came from, and can outlive its item too. */
  it('resolves a card whose item is gone as Normal', async () => {
    // Parked far out, so the projection has something to move and the level shows.
    const orphan = await store.cards.create(
      mature({ id: undefined, itemId: 'gone', due: new Date(NOW.getTime() + 100 * DAY_MS) }),
    )
    const impact = await simulate()({ cardIds: [orphan.id] })
    expect(impact.changes[0]).toMatchObject({ level: 'normal', desiredRetention: 0.9 })
  })

  it('applies the projection: only `due` and `scheduledDays` move', async () => {
    const before = await store.cards.findById(cardId)
    const { impact, applied } = await apply()({ confirm: true })

    expect(applied).toBe(1)
    const after = await store.cards.findById(cardId)
    expect(after?.due).toEqual(impact.changes[0]?.newDue)
    expect(after?.scheduledDays).toBe(impact.changes[0]?.newIntervalDays)
    // Never the memory state, never the counters (`fsrs-rules`).
    expect(after?.stability).toBe(before?.stability)
    expect(after?.difficulty).toBe(before?.difficulty)
    expect(after?.lastReview).toEqual(before?.lastReview)
    expect(after?.reps).toBe(before?.reps)
    expect(after?.lapses).toBe(before?.lapses)
    expect(after?.state).toBe(before?.state)
  })

  it('logs every move as a manual review, so the optimizer ignores it', async () => {
    await apply()({ confirm: true })
    const [log, ...rest] = await store.reviewLogs.listByCard(cardId)
    expect(rest).toHaveLength(0)
    expect(log).toMatchObject({
      rating: RATING.Manual,
      context: 'manual_postpone',
      stability: 30,
      difficulty: 5,
      review: NOW,
    })
  })

  it('refuses to apply without an explicit confirmation', async () => {
    await expect(apply()({ confirm: false as never })).rejects.toBeInstanceOf(RangeError)
    expect(store.updateCalls).toBe(0)
  })

  it('writes nothing when the projection moves nothing', async () => {
    await store.knowledgeItems.create(knowledgeItemFixture({ id: itemId }))
    const { applied } = await apply()({ cardIds: ['nobody'], confirm: true })
    expect(applied).toBe(0)
    expect(store.appendCalls).toBe(0)
  })

  /**
   * The apply re-reads and re-projects rather than replaying the summary the dialog showed,
   * so a review that lands between the simulation and the confirmation is respected instead
   * of being overwritten with a due date computed from stale stability. The cost is that
   * the confirmed numbers are a preview, not a contract — binding the two would need a
   * projection token the user's confirmation carries back.
   */
  it('applies current state, not the projection the user was shown', async () => {
    const projected = await simulate()()
    expect(projected.affected).toBe(1)

    // A review lands in between: the card is now far more stable.
    await store.cards.update(cardId, { stability: 300 })

    const { impact } = await apply()({ confirm: true })
    expect(impact.changes[0]?.newIntervalDays).not.toBe(projected.changes[0]?.newIntervalDays)
    const after = await store.cards.findById(cardId)
    expect(after?.scheduledDays).toBe(impact.changes[0]?.newIntervalDays)
    expect(after?.stability).toBe(300)
  })

  it('rolls the card update and its log back together', async () => {
    const before = await store.cards.findById(cardId)
    const append = store.reviewLogs.append
    store.reviewLogs.append = async () => {
      throw new Error('disk full')
    }
    try {
      await expect(apply()({ confirm: true })).rejects.toThrow('disk full')
    } finally {
      store.reviewLogs.append = append
    }
    expect(await store.cards.findById(cardId)).toEqual(before)
    expect(store.reviewLogs.all()).toEqual([])
  })
})
