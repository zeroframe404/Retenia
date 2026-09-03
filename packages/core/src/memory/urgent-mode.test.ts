import { beforeEach, describe, expect, it } from 'vitest'
import { fakeClock } from '../testing/in-memory-job-repository'
import {
  createInMemoryReviewStore,
  type InMemoryReviewStore,
} from '../testing/in-memory-review-store'
import { cardFixture, knowledgeItemFixture } from '../testing/memory-fixtures'
import { HOUR_MS } from './study-day'
import {
  createEndUrgentMode,
  createExpireUrgentMode,
  createStartUrgentMode,
  DEFAULT_URGENT_MODE_HOURS,
  URGENT_MODE_HOURS,
  urgentModeExpiry,
} from './urgent-mode'

const NOW = new Date('2026-01-05T08:00:00.000Z')

let clock: ReturnType<typeof fakeClock>
let store: InMemoryReviewStore
let itemId: string
let cardIds: string[]

beforeEach(async () => {
  clock = fakeClock(NOW.getTime())
  store = createInMemoryReviewStore(clock)
  const item = await store.knowledgeItems.create(
    knowledgeItemFixture({ id: undefined, importance: 'normal' }),
  )
  itemId = item.id
  const a = await store.cards.create(cardFixture({ id: undefined, itemId, template: 'basic' }))
  const b = await store.cards.create(cardFixture({ id: undefined, itemId, template: 'reverse' }))
  cardIds = [a.id, b.id]
})

describe('createStartUrgentMode', () => {
  it('overrides every card of every item, with a window §7 rule 5 allows', async () => {
    const start = createStartUrgentMode({ uow: store, clock })
    const result = await start({ itemIds: [itemId], hours: 72 })

    expect(result).toEqual({
      items: 1,
      cards: 2,
      expiresAt: new Date(NOW.getTime() + 72 * HOUR_MS),
    })
    for (const id of cardIds) {
      const card = await store.cards.findById(id)
      expect(card?.importanceOverride).toBe('urgent')
      expect(card?.importanceOverrideExpiresAt).toEqual(result.expiresAt)
    }
  })

  it('defaults to 48 hours', async () => {
    const result = await createStartUrgentMode({ uow: store, clock })({ itemIds: [itemId] })
    expect(DEFAULT_URGENT_MODE_HOURS).toBe(48)
    expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 48 * HOUR_MS))
  })

  it('falls back to the system clock when it was given none', async () => {
    const before = Date.now()
    const result = await createStartUrgentMode({ uow: store })({ itemIds: [itemId] })
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 48 * HOUR_MS)
    // The sweep's default clock too: nothing has lapsed yet, so it clears nothing.
    expect(await createExpireUrgentMode({ uow: store })()).toBe(0)
  })

  it('takes an explicit `now` over the clock', async () => {
    const now = new Date('2026-02-01T00:00:00.000Z')
    const result = await createStartUrgentMode({ uow: store, clock })({ itemIds: [itemId], now })
    expect(result.expiresAt).toEqual(new Date(now.getTime() + 48 * HOUR_MS))
  })

  it('refuses any window but 48 or 72 hours', async () => {
    const start = createStartUrgentMode({ uow: store, clock })
    await expect(start({ itemIds: [itemId], hours: 24 as never })).rejects.toBeInstanceOf(
      RangeError,
    )
    expect([...URGENT_MODE_HOURS]).toEqual([48, 72])
  })

  it('refuses anything that is not a list of ids', async () => {
    const start = createStartUrgentMode({ uow: store, clock })
    await expect(start({ itemIds: 'nope' as never })).rejects.toBeInstanceOf(TypeError)
  })

  it('writes nothing for an empty list, or for items with no cards', async () => {
    const start = createStartUrgentMode({ uow: store, clock })
    expect(await start({ itemIds: [] })).toMatchObject({ items: 0, cards: 0 })
    expect(await start({ itemIds: ['nobody'] })).toMatchObject({ items: 0, cards: 0 })
    expect(store.updateCalls).toBe(0)
  })

  /** Importance changes what the next review asks for, never what is already booked. */
  it('never moves a due date or touches the memory state', async () => {
    const before = store.cards.all().map((card) => ({ ...card }))
    await createStartUrgentMode({ uow: store, clock })({ itemIds: [itemId] })
    for (const [index, card] of store.cards.all().entries()) {
      const was = before[index] as (typeof before)[number]
      expect(card.due).toEqual(was.due)
      expect(card.stability).toBe(was.stability)
      expect(card.difficulty).toBe(was.difficulty)
      expect(card.scheduledDays).toBe(was.scheduledDays)
      expect(card.lastReview).toEqual(was.lastReview)
    }
  })
})

describe('createEndUrgentMode', () => {
  it('clears the override and its expiry', async () => {
    await createStartUrgentMode({ uow: store, clock })({ itemIds: [itemId] })
    const result = await createEndUrgentMode({ uow: store, clock })([itemId])

    expect(result).toEqual({ items: 1, cards: 2 })
    for (const id of cardIds) {
      const card = await store.cards.findById(id)
      expect(card?.importanceOverride).toBeNull()
      expect(card?.importanceOverrideExpiresAt).toBeNull()
    }
  })

  it('leaves a permanent override alone — it is not urgent mode', async () => {
    await store.cards.overrideImportance([cardIds[0] as string], 'high', null)
    expect(await createEndUrgentMode({ uow: store, clock })([itemId])).toEqual({
      items: 0,
      cards: 0,
    })
    expect((await store.cards.findById(cardIds[0] as string))?.importanceOverride).toBe('high')
  })

  it('writes nothing for an empty list, and refuses a non-list', async () => {
    const end = createEndUrgentMode({ uow: store, clock })
    expect(await end([])).toEqual({ items: 0, cards: 0 })
    await expect(end('nope' as never)).rejects.toBeInstanceOf(TypeError)
  })
})

describe('createExpireUrgentMode', () => {
  it('clears the windows that have closed and leaves the open ones', async () => {
    const start = createStartUrgentMode({ uow: store, clock })
    await start({ itemIds: [itemId], hours: 48 })
    const other = await store.knowledgeItems.create(knowledgeItemFixture({ id: undefined }))
    const openCard = await store.cards.create(cardFixture({ id: undefined, itemId: other.id }))
    await start({ itemIds: [other.id], hours: 72 })

    clock.advance(49 * HOUR_MS)
    expect(await createExpireUrgentMode({ uow: store, clock })()).toBe(2)

    for (const id of cardIds) {
      expect((await store.cards.findById(id))?.importanceOverride).toBeNull()
    }
    expect((await store.cards.findById(openCard.id))?.importanceOverride).toBe('urgent')
  })

  it('is idempotent, and takes an explicit `now`', async () => {
    await createStartUrgentMode({ uow: store, clock })({ itemIds: [itemId] })
    const expire = createExpireUrgentMode({ uow: store, clock })
    const later = new Date(NOW.getTime() + 49 * HOUR_MS)
    expect(await expire(later)).toBe(2)
    expect(await expire(later)).toBe(0)
  })
})

describe('urgentModeExpiry', () => {
  it('reports the window only while it is open', () => {
    const expiresAt = new Date(NOW.getTime() + HOUR_MS)
    const card = cardFixture({
      importanceOverride: 'urgent',
      importanceOverrideExpiresAt: expiresAt,
    })
    expect(urgentModeExpiry(card, NOW)).toEqual(expiresAt)
    expect(urgentModeExpiry(card, expiresAt)).toBeNull()
    expect(urgentModeExpiry(cardFixture({ importanceOverride: 'high' }), NOW)).toBeNull()
    expect(
      urgentModeExpiry(cardFixture({ importanceOverrideExpiresAt: expiresAt }), NOW),
    ).toBeNull()
  })
})
