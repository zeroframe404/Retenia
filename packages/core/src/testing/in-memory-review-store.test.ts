import { describe, expect, it } from 'vitest'
import { EntityNotFoundError, OptimisticConcurrencyError } from '../ports/errors'
import { fakeClock } from './in-memory-job-repository'
import { createInMemoryReviewStore } from './in-memory-review-store'
import { cardFixture, knowledgeItemFixture, reviewLogFixture } from './memory-fixtures'

describe('createInMemoryReviewStore', () => {
  it('stores cards, items and logs with the audit set and bumps versions on update', async () => {
    const clock = fakeClock()
    const store = createInMemoryReviewStore(clock, { deviceId: 'dev-1' })
    const item = await store.knowledgeItems.create(knowledgeItemFixture())
    const card = await store.cards.create(cardFixture({ itemId: item.id }))
    expect(card).toMatchObject({ deviceId: 'dev-1', version: 1, createdAt: clock.now() })
    expect(await store.knowledgeItems.findById(item.id)).toEqual(item)

    clock.advance(1000)
    const updated = await store.cards.update(card.id, { reps: 3, version: 1 })
    expect(updated).toMatchObject({ reps: 3, version: 2, updatedAt: clock.now() })
    expect(store.cards.all()).toEqual([updated])
    await expect(store.cards.update(card.id, { reps: 4, version: 1 })).rejects.toBeInstanceOf(
      OptimisticConcurrencyError,
    )
    await expect(store.cards.update('nope', { reps: 4 })).rejects.toBeInstanceOf(
      EntityNotFoundError,
    )
    expect(await store.cards.findById('nope')).toBeUndefined()

    const log = await store.reviewLogs.append({
      ...reviewLogFixture(),
      cardId: card.id,
      id: undefined,
    })
    expect(log.version).toBe(1)
    expect(await store.reviewLogs.listByCard(card.id)).toEqual([log])
    expect(store.appendCalls).toBe(1)
    expect(store.updateCalls).toBe(3)
  })

  it('hides soft-deleted rows unless asked, and orders a history by review time', async () => {
    const clock = fakeClock()
    const store = createInMemoryReviewStore(clock)
    const card = await store.cards.create(cardFixture())
    await store.cards.update(card.id, { deletedAt: clock.now() } as never)
    expect(await store.cards.findById(card.id)).toBeUndefined()
    expect(await store.cards.findById(card.id, { includeDeleted: true })).toBeDefined()

    const later = await store.reviewLogs.append({
      ...reviewLogFixture({ review: new Date(2000) }),
      id: undefined,
    })
    const earlier = await store.reviewLogs.append({
      ...reviewLogFixture({ review: new Date(1000) }),
      id: undefined,
    })
    expect((await store.reviewLogs.listByCard(card.id)).map((log) => log.id)).toEqual([
      earlier.id,
      later.id,
    ])
  })

  it('rolls a failed transaction back and joins nested ones', async () => {
    const store = createInMemoryReviewStore(fakeClock())
    const card = await store.cards.create(cardFixture())
    await expect(
      store.transaction(async (repos) => {
        await repos.cards.update(card.id, { reps: 9 })
        await repos.reviewLogs.append({ ...reviewLogFixture(), id: undefined })
        await store.transaction(async (inner) => {
          await inner.cards.update(card.id, { lapses: 9 })
        })
        throw new Error('abort')
      }),
    ).rejects.toThrow('abort')
    expect(await store.cards.findById(card.id)).toEqual(card)
    expect(store.reviewLogs.all()).toEqual([])
    expect(store.appendCalls).toBe(1)

    const committed = await store.transaction(async (repos) =>
      repos.cards.update(card.id, { reps: 1 }),
    )
    expect(committed.reps).toBe(1)
    expect((await store.cards.findById(card.id))?.reps).toBe(1)
  })
})
