import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ContractContext, RepositoryContractHarness } from '../harness'

const DAY = 86_400_000

/**
 * `findDue` and `countByImportance` — the scheduler's window onto the database
 * (`docs/spec/02-memory-system.md` §7 and §9).
 *
 * Every exclusion here is a rule a user would notice: a suspended card reappearing, a
 * buried sibling showing up in the same session, a paused deck coming back, or a card
 * outliving the item it renders.
 */
export function cardsContract(harness: RepositoryContractHarness): void {
  describe('card scheduling queries', () => {
    let ctx: ContractContext
    beforeEach(async () => {
      ctx = await harness.create()
    })
    afterEach(async () => {
      await ctx.dispose()
    })

    /** A card due `offsetMs` from now, on an item with the given importance. */
    async function dueCard(
      offsetMs: number,
      overrides: Parameters<ContractContext['seed']['card']>[0] = {},
    ) {
      return ctx.seed.card({ due: new Date(ctx.clock.now().getTime() + offsetMs), ...overrides })
    }

    it('returns a card whose due date has passed', async () => {
      const card = await dueCard(-DAY)
      const due = await ctx.repos.cards.findDue(ctx.clock.now())
      expect(due.map((entry) => entry.id)).toEqual([card.id])
    })

    it('excludes a card that is not due yet', async () => {
      await dueCard(DAY)
      expect(await ctx.repos.cards.findDue(ctx.clock.now())).toEqual([])
    })

    it('includes a card exactly at its due instant', async () => {
      await dueCard(0)
      expect(await ctx.repos.cards.findDue(ctx.clock.now())).toHaveLength(1)
    })

    it('excludes a suspended card', async () => {
      const card = await dueCard(-DAY)
      await ctx.repos.cards.setSuspended(card.id, true)
      expect(await ctx.repos.cards.findDue(ctx.clock.now())).toEqual([])
    })

    it('brings a card back when it is unsuspended', async () => {
      const card = await dueCard(-DAY)
      await ctx.repos.cards.setSuspended(card.id, true)
      await ctx.repos.cards.setSuspended(card.id, false)
      expect(await ctx.repos.cards.findDue(ctx.clock.now())).toHaveLength(1)
    })

    it('excludes a card buried into the future, and returns it once the burial expires', async () => {
      const card = await dueCard(-DAY)
      await ctx.repos.cards.buryUntil(card.id, new Date(ctx.clock.now().getTime() + DAY))
      expect(await ctx.repos.cards.findDue(ctx.clock.now())).toEqual([])

      ctx.clock.advance(DAY)
      expect(await ctx.repos.cards.findDue(ctx.clock.now())).toHaveLength(1)
    })

    it('returns a card whose burial has been lifted', async () => {
      const card = await dueCard(-DAY)
      await ctx.repos.cards.buryUntil(card.id, new Date(ctx.clock.now().getTime() + DAY))
      await ctx.repos.cards.buryUntil(card.id, null)
      expect(await ctx.repos.cards.findDue(ctx.clock.now())).toHaveLength(1)
    })

    it('excludes a soft-deleted card', async () => {
      const card = await dueCard(-DAY)
      await ctx.repos.cards.softDelete(card.id)
      expect(await ctx.repos.cards.findDue(ctx.clock.now())).toEqual([])
    })

    it('excludes a card whose knowledge item was soft-deleted', async () => {
      // Nothing cascades item deletion to cards in SQL, so the query has to carry it.
      const item = await ctx.seed.knowledgeItem()
      await dueCard(-DAY, { itemId: item.id })
      await ctx.repos.knowledgeItems.softDelete(item.id)
      expect(await ctx.repos.cards.findDue(ctx.clock.now())).toEqual([])
    })

    it('excludes cards of an item that is not active', async () => {
      // `need_to_learn` = generated but not scheduled; `archived` = out of the queue for good.
      for (const status of ['need_to_learn', 'archived'] as const) {
        const item = await ctx.seed.knowledgeItem({ status })
        await dueCard(-DAY, { itemId: item.id })
      }
      expect(await ctx.repos.cards.findDue(ctx.clock.now())).toEqual([])
    })

    it('excludes a paused item unless the caller opts in', async () => {
      const item = await ctx.seed.knowledgeItem({ importance: 'paused' })
      await dueCard(-DAY, { itemId: item.id })

      expect(await ctx.repos.cards.findDue(ctx.clock.now())).toEqual([])
      expect(await ctx.repos.cards.findDue(ctx.clock.now(), { includePaused: true })).toHaveLength(
        1,
      )
    })

    it('filters on the effective importance, with the card override beating the item', async () => {
      const normalItem = await ctx.seed.knowledgeItem({ importance: 'normal' })
      const urgentItem = await ctx.seed.knowledgeItem({ importance: 'urgent' })
      const promoted = await dueCard(-DAY, { itemId: normalItem.id, importanceOverride: 'urgent' })
      const demoted = await dueCard(-DAY, {
        itemId: urgentItem.id,
        importanceOverride: 'maintenance',
      })

      const urgent = await ctx.repos.cards.findDue(ctx.clock.now(), { importance: ['urgent'] })
      expect(urgent.map((entry) => entry.id)).toEqual([promoted.id])

      const maintenance = await ctx.repos.cards.findDue(ctx.clock.now(), {
        importance: ['maintenance'],
      })
      expect(maintenance.map((entry) => entry.id)).toEqual([demoted.id])
    })

    it('hides a paused override even when the item is not paused', async () => {
      const item = await ctx.seed.knowledgeItem({ importance: 'urgent' })
      await dueCard(-DAY, { itemId: item.id, importanceOverride: 'paused' })
      expect(await ctx.repos.cards.findDue(ctx.clock.now())).toEqual([])
    })

    it('filters by card state', async () => {
      const review = await dueCard(-DAY, { state: 2 })
      await dueCard(-DAY, { state: 0 })
      const found = await ctx.repos.cards.findDue(ctx.clock.now(), { states: [2] })
      expect(found.map((entry) => entry.id)).toEqual([review.id])
    })

    it('orders by due ascending, oldest first', async () => {
      const newest = await dueCard(-DAY)
      const oldest = await dueCard(-5 * DAY)
      const middle = await dueCard(-3 * DAY)
      const due = await ctx.repos.cards.findDue(ctx.clock.now())
      expect(due.map((entry) => entry.id)).toEqual([oldest.id, middle.id, newest.id])
    })

    it('honours the limit', async () => {
      await dueCard(-DAY)
      await dueCard(-2 * DAY)
      await dueCard(-3 * DAY)
      expect(await ctx.repos.cards.findDue(ctx.clock.now(), { limit: 2 })).toHaveLength(2)
    })

    it('counts by importance with every level present', async () => {
      const item = await ctx.seed.knowledgeItem({ importance: 'high' })
      await dueCard(-DAY, { itemId: item.id })
      await dueCard(-DAY, { itemId: item.id })

      const counts = await ctx.repos.cards.countByImportance()
      expect(counts.high).toBe(2)
      // Total by construction, so no caller has to handle `undefined`.
      expect(counts).toMatchObject({ urgent: 0, normal: 0, maintenance: 0, paused: 0 })
    })

    it('agrees with findDue over the same window', async () => {
      await dueCard(-DAY)
      await dueCard(DAY)

      const due = await ctx.repos.cards.findDue(ctx.clock.now())
      const counts = await ctx.repos.cards.countByImportance({ dueBefore: ctx.clock.now() })
      const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
      expect(total).toBe(due.length)
    })

    it('leaves suspended cards out of the counts unless asked for', async () => {
      const card = await dueCard(-DAY)
      await ctx.repos.cards.setSuspended(card.id, true)

      const counts = await ctx.repos.cards.countByImportance()
      expect(counts.normal).toBe(0)

      const withSuspended = await ctx.repos.cards.countByImportance({ includeSuspended: true })
      expect(withSuspended.normal).toBe(1)
    })

    it('upserts a batch in one go', async () => {
      const first = await dueCard(-DAY)
      const second = await dueCard(-DAY)

      await ctx.repos.cards.bulkSave([
        { ...first, reps: 3 },
        { ...second, reps: 5 },
      ])

      expect((await ctx.repos.cards.findById(first.id))?.reps).toBe(3)
      expect((await ctx.repos.cards.findById(second.id))?.reps).toBe(5)
    })

    it('lists every card of one item', async () => {
      const item = await ctx.seed.knowledgeItem()
      await dueCard(-DAY, { itemId: item.id, template: 'basic' })
      await dueCard(-DAY, { itemId: item.id, template: 'reverse' })
      // No uniqueness on (item_id, template) — one skill may be rendered several times.
      await dueCard(-DAY, { itemId: item.id, template: 'reverse' })
      expect(await ctx.repos.cards.findByItem(item.id)).toHaveLength(3)
    })

    describe('bulk importance overrides', () => {
      it('sets and clears the per-card override across many cards', async () => {
        const item = await ctx.seed.knowledgeItem({ importance: 'normal' })
        const a = await ctx.seed.card({ itemId: item.id, template: 'basic' })
        const b = await ctx.seed.card({ itemId: item.id, template: 'reverse' })

        expect(await ctx.repos.cards.overrideImportance([a.id, b.id], 'urgent')).toBe(2)
        for (const id of [a.id, b.id]) {
          const card = await ctx.repos.cards.findById(id)
          expect(card?.importanceOverride).toBe('urgent')
          expect(card?.importanceOverrideExpiresAt).toBeNull()
        }
        // The override is what the queue filters on, not the item's level.
        const due = await ctx.repos.cards.findDue(new Date(ctx.clock.now().getTime() + DAY), {
          importance: ['urgent'],
        })
        expect(due.map((card) => card.id).sort()).toEqual([a.id, b.id].sort())

        expect(await ctx.repos.cards.overrideImportance([a.id, b.id], null)).toBe(2)
        expect((await ctx.repos.cards.findById(a.id))?.importanceOverride).toBeNull()
      })

      /** An expiry is what makes an override urgent mode (§7 rule 5). */
      it('stores an expiry with the level, and drops it when the level is cleared', async () => {
        const card = await ctx.seed.card()
        const expiresAt = new Date(ctx.clock.now().getTime() + 2 * DAY)

        await ctx.repos.cards.overrideImportance([card.id], 'urgent', expiresAt)
        expect((await ctx.repos.cards.findById(card.id))?.importanceOverrideExpiresAt).toEqual(
          expiresAt,
        )

        await ctx.repos.cards.overrideImportance([card.id], null, expiresAt)
        expect((await ctx.repos.cards.findById(card.id))?.importanceOverrideExpiresAt).toBeNull()
      })

      it('writes nothing for an empty list', async () => {
        expect(await ctx.repos.cards.overrideImportance([], 'urgent')).toBe(0)
      })

      it('clears only the windows that have closed', async () => {
        const lapsed = await ctx.seed.card({ template: 'a' })
        const open = await ctx.seed.card({ template: 'b' })
        const permanent = await ctx.seed.card({ template: 'c' })
        const now = ctx.clock.now()
        await ctx.repos.cards.overrideImportance(
          [lapsed.id],
          'urgent',
          new Date(now.getTime() + DAY),
        )
        await ctx.repos.cards.overrideImportance(
          [open.id],
          'urgent',
          new Date(now.getTime() + 5 * DAY),
        )
        await ctx.repos.cards.overrideImportance([permanent.id], 'high')

        ctx.clock.advance(2 * DAY)
        expect(await ctx.repos.cards.clearExpiredOverrides(ctx.clock.now())).toBe(1)
        expect((await ctx.repos.cards.findById(lapsed.id))?.importanceOverride).toBeNull()
        expect((await ctx.repos.cards.findById(open.id))?.importanceOverride).toBe('urgent')
        expect((await ctx.repos.cards.findById(permanent.id))?.importanceOverride).toBe('high')

        // Idempotent.
        expect(await ctx.repos.cards.clearExpiredOverrides(ctx.clock.now())).toBe(0)
      })

      /**
       * The acceptance criterion: a level change moves no due date. Anki's "reschedule
       * cards on change = off" — the new retention applies from the next review
       * (`docs/spec/02-memory-system.md` §7 rule 2).
       */
      it('never touches the schedule or the memory state', async () => {
        const item = await ctx.seed.knowledgeItem({ importance: 'normal' })
        const card = await ctx.seed.card({ itemId: item.id, stability: 30, difficulty: 5 })

        await ctx.repos.knowledgeItems.setImportanceMany([item.id], 'urgent')
        await ctx.repos.cards.overrideImportance([card.id], 'maintenance')

        expect(await ctx.repos.cards.findById(card.id)).toMatchObject({
          due: card.due,
          stability: card.stability,
          difficulty: card.difficulty,
          scheduledDays: card.scheduledDays,
          lastReview: card.lastReview,
          state: card.state,
          reps: card.reps,
          lapses: card.lapses,
        })
      })
    })

    /**
     * The scheduler ignores a lapsed override on every read, so SQL must too. The sweep
     * only runs at startup, so without this the two would disagree for the whole of a
     * session in which a 48-hour urgent window closed: the queue would still order those
     * cards as urgent and the bias warning would still count them.
     */
    it('stops counting and queueing an override once its window has closed', async () => {
      const item = await ctx.seed.knowledgeItem({ importance: 'normal' })
      const card = await ctx.seed.card({
        itemId: item.id,
        due: new Date(ctx.clock.now().getTime() - DAY),
      })
      await ctx.repos.cards.overrideImportance(
        [card.id],
        'urgent',
        new Date(ctx.clock.now().getTime() + DAY),
      )

      expect((await ctx.repos.cards.countByImportance()).urgent).toBe(1)
      const beforeQueue = await ctx.repos.cards.findDue(ctx.clock.now(), {
        importance: ['urgent'],
      })
      expect(beforeQueue.map((entry) => entry.id)).toEqual([card.id])

      // The window closes. Nothing is swept — the read alone must be enough.
      ctx.clock.advance(2 * DAY)
      const counts = await ctx.repos.cards.countByImportance()
      expect(counts.urgent).toBe(0)
      expect(counts.normal).toBe(1)
      expect(await ctx.repos.cards.findDue(ctx.clock.now(), { importance: ['urgent'] })).toEqual([])
      const asNormal = await ctx.repos.cards.findDue(ctx.clock.now(), {
        importance: ['normal'],
      })
      expect(asNormal.map((entry) => entry.id)).toEqual([card.id])
    })

    /** `paused` is out of the queue — but only while the override that set it is live. */
    it('brings a card back into the queue when a paused override lapses', async () => {
      const card = await ctx.seed.card({ due: new Date(ctx.clock.now().getTime() - DAY) })
      await ctx.repos.cards.overrideImportance(
        [card.id],
        'paused',
        new Date(ctx.clock.now().getTime() + DAY),
      )
      expect(await ctx.repos.cards.findDue(ctx.clock.now())).toEqual([])

      ctx.clock.advance(2 * DAY)
      const due = await ctx.repos.cards.findDue(ctx.clock.now())
      expect(due.map((entry) => entry.id)).toEqual([card.id])
    })

    describe('listByItems', () => {
      it('returns every live card of every named item', async () => {
        const one = await ctx.seed.knowledgeItem()
        const two = await ctx.seed.knowledgeItem()
        const a = await ctx.seed.card({ itemId: one.id, template: 'basic' })
        const b = await ctx.seed.card({ itemId: one.id, template: 'reverse' })
        const c = await ctx.seed.card({ itemId: two.id, template: 'basic' })

        const found = await ctx.repos.cards.listByItems([one.id, two.id])
        expect(found.map((card) => card.id).sort()).toEqual([a.id, b.id, c.id].sort())
        expect(await ctx.repos.cards.listByItems([])).toEqual([])
        expect(await ctx.repos.cards.listByItems(['nobody'])).toEqual([])
      })

      it('leaves a soft-deleted card out', async () => {
        const item = await ctx.seed.knowledgeItem()
        const card = await ctx.seed.card({ itemId: item.id })
        await ctx.repos.cards.softDelete(card.id)
        expect(await ctx.repos.cards.listByItems([item.id])).toEqual([])
      })
    })

    describe('knowledgeItems.countByImportance and setImportanceMany', () => {
      it('counts live items per level, every level present', async () => {
        await ctx.seed.knowledgeItem({ importance: 'urgent' })
        await ctx.seed.knowledgeItem({ importance: 'urgent' })
        const parked = await ctx.seed.knowledgeItem({ importance: 'paused' })

        expect(await ctx.repos.knowledgeItems.countByImportance()).toEqual({
          urgent: 2,
          high: 0,
          normal: 0,
          maintenance: 0,
          paused: 1,
        })

        await ctx.repos.knowledgeItems.softDelete(parked.id)
        expect((await ctx.repos.knowledgeItems.countByImportance()).paused).toBe(0)
      })

      it('moves many items at once, bumping every row version', async () => {
        const one = await ctx.seed.knowledgeItem({ importance: 'normal' })
        const two = await ctx.seed.knowledgeItem({ importance: 'normal' })

        expect(await ctx.repos.knowledgeItems.setImportanceMany([one.id, two.id], 'high')).toBe(2)
        expect(await ctx.repos.knowledgeItems.findById(one.id)).toMatchObject({
          importance: 'high',
          version: 2,
        })
        expect(await ctx.repos.knowledgeItems.findById(two.id)).toMatchObject({
          importance: 'high',
        })
        expect(await ctx.repos.knowledgeItems.setImportanceMany([], 'normal')).toBe(0)
      })
    })
  })
}
