import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ContractContext, RepositoryContractHarness } from '../harness'

/**
 * The append-only review log.
 *
 * A rewritten review would corrupt the optimizer's training set and make `rollback`
 * unsound, so the port exposes no way to mutate one and the schema refuses it as a
 * backstop. Both halves are tested: the type-level absence is checked structurally, and the
 * database-level CHECK with a raw write on adapters that enforce constraints.
 */
export function reviewLogsContract(harness: RepositoryContractHarness): void {
  describe('review logs (append-only)', () => {
    let ctx: ContractContext
    beforeEach(async () => {
      ctx = await harness.create()
    })
    afterEach(async () => {
      await ctx.dispose()
    })

    it('exposes no mutating method at all', () => {
      const repo = ctx.repos.reviewLogs as unknown as Record<string, unknown>
      for (const method of ['update', 'save', 'softDelete', 'restore', 'create']) {
        expect(repo[method]).toBeUndefined()
      }
    })

    it('appends a review at version 1 with updated_at === created_at', async () => {
      const log = await ctx.seed.reviewLog()
      expect(log.version).toBe(1)
      expect(log.updatedAt.getTime()).toBe(log.createdAt.getTime())
    })

    it('keeps the pre-review values, which is what makes rollback possible', async () => {
      const log = await ctx.seed.reviewLog({ state: 2, stability: 12.5, difficulty: 5.5 })
      const stored = await ctx.repos.reviewLogs.findById(log.id)
      expect(stored).toMatchObject({ state: 2, stability: 12.5, difficulty: 5.5 })
    })

    it('accepts a negative elapsed_days', async () => {
      // An import or a clock step can produce one, and a review must never be lost to a
      // constraint (`docs/spec/07a-schema.md`, FSRS parity note).
      const log = await ctx.seed.reviewLog({ elapsedDays: -3 })
      expect((await ctx.repos.reviewLogs.findById(log.id))?.elapsedDays).toBe(-3)
    })

    it('lists a card history oldest first', async () => {
      const card = await ctx.seed.card()
      const now = ctx.clock.now().getTime()
      await ctx.seed.reviewLog({ cardId: card.id, review: new Date(now - 3000) })
      await ctx.seed.reviewLog({ cardId: card.id, review: new Date(now - 1000) })
      await ctx.seed.reviewLog({ cardId: card.id, review: new Date(now - 2000) })

      const history = await ctx.repos.reviewLogs.listByCard(card.id)
      const times = history.map((log) => log.review.getTime())
      expect(times).toEqual([...times].sort((a, b) => a - b))
      expect(await ctx.repos.reviewLogs.countByCard(card.id)).toBe(3)
    })

    /**
     * §16's optimizer cadence counts reviews, and it must count the same rows the training
     * set holds — otherwise the 2ⁿ threshold advances on postpones the model never sees.
     */
    it('counts reviews, with the window and the manual exclusion the optimizer uses', async () => {
      const card = await ctx.seed.card()
      const now = ctx.clock.now().getTime()
      await ctx.seed.reviewLog({ cardId: card.id, rating: 3, review: new Date(now - 3000) })
      await ctx.seed.reviewLog({ cardId: card.id, rating: 1, review: new Date(now - 2000) })
      // A postpone: rating 0 is not an answer (`fsrs-rules`).
      await ctx.seed.reviewLog({ cardId: card.id, rating: 0, review: new Date(now - 1000) })

      expect(await ctx.repos.reviewLogs.count()).toBe(3)
      expect(await ctx.repos.reviewLogs.count({ excludeManual: true })).toBe(2)
      expect(await ctx.repos.reviewLogs.count({ from: new Date(now - 2500) })).toBe(2)
      expect(await ctx.repos.reviewLogs.count({ to: new Date(now - 2500) })).toBe(1)
      expect(
        await ctx.repos.reviewLogs.count({
          from: new Date(now - 2500),
          to: new Date(now - 1500),
          excludeManual: true,
        }),
      ).toBe(1)
    })

    it('leaves soft-deleted rows out of the count', async () => {
      const card = await ctx.seed.card()
      const log = await ctx.seed.reviewLog({ cardId: card.id, rating: 3 })
      expect(await ctx.repos.reviewLogs.count()).toBe(1)
      await ctx.repos.reviewLogs.softDeleteById(log.id, ctx.clock.now())
      expect(await ctx.repos.reviewLogs.count()).toBe(0)
    })

    it('finds the most recent review of a card', async () => {
      const card = await ctx.seed.card()
      const now = ctx.clock.now().getTime()
      await ctx.seed.reviewLog({ cardId: card.id, review: new Date(now - 3000) })
      const latest = await ctx.seed.reviewLog({ cardId: card.id, review: new Date(now - 1000) })
      expect((await ctx.repos.reviewLogs.findLastByCard(card.id))?.id).toBe(latest.id)
    })

    it('lists a half-open window, so adjacent ranges never double-count', async () => {
      const card = await ctx.seed.card()
      const now = ctx.clock.now().getTime()
      await ctx.seed.reviewLog({ cardId: card.id, review: new Date(now - 1000) })
      await ctx.seed.reviewLog({ cardId: card.id, review: new Date(now) })

      const window = await ctx.repos.reviewLogs.listSince(new Date(now - 1000), new Date(now))
      expect(window).toHaveLength(1)
    })

    it('soft-deletes a card history without rewriting it', async () => {
      const card = await ctx.seed.card()
      await ctx.seed.reviewLog({ cardId: card.id })
      await ctx.seed.reviewLog({ cardId: card.id })

      const removed = await ctx.repos.reviewLogs.softDeleteForCard(card.id, ctx.clock.now())
      expect(removed).toBe(2)
      expect(await ctx.repos.reviewLogs.listByCard(card.id)).toEqual([])

      // The one mutation the CHECK allows: `deleted_at` alone, version untouched.
      const kept = await ctx.repos.reviewLogs.listByCard(card.id, { includeDeleted: true })
      expect(kept).toHaveLength(2)
      for (const log of kept) {
        expect(log.version).toBe(1)
        expect(log.updatedAt.getTime()).toBe(log.createdAt.getTime())
        expect(log.deletedAt).toBeInstanceOf(Date)
      }
    })

    it('takes the review history with the card when the card is soft-deleted', async () => {
      const card = await ctx.seed.card()
      await ctx.seed.reviewLog({ cardId: card.id })

      await ctx.repos.cards.softDelete(card.id)

      expect(await ctx.repos.reviewLogs.listByCard(card.id)).toEqual([])
      // Nothing was actually removed, here or anywhere else.
      expect(await ctx.countRows('review_logs')).toBe(1)
    })

    it('brings the history back when the card is restored', async () => {
      const card = await ctx.seed.card()
      await ctx.seed.reviewLog({ cardId: card.id })
      await ctx.repos.cards.softDelete(card.id)

      await ctx.repos.cards.restore(card.id)

      const restored = await ctx.repos.reviewLogs.listByCard(card.id)
      expect(restored).toHaveLength(1)
      expect(restored[0]?.version).toBe(1)
    })
  })
}
