import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ContractContext, RepositoryContractHarness } from '../harness'

/**
 * The transactional boundary.
 *
 * The ports are async while the SQLite adapter underneath is synchronous, which is exactly
 * the combination that goes wrong quietly: a driver whose transaction wrapper commits when
 * the callback *returns* would commit at the first `await` and let the rest of the work
 * land outside the transaction. These tests are what prove the adapter does not do that.
 */
export function unitOfWorkContract(harness: RepositoryContractHarness): void {
  describe('unit of work', () => {
    let ctx: ContractContext
    beforeEach(async () => {
      ctx = await harness.create()
    })
    afterEach(async () => {
      await ctx.dispose()
    })

    it('commits every write of a successful transaction', async () => {
      const ids = await ctx.repos.transaction(async (repos) => {
        const item = await repos.knowledgeItems.create(newItem())
        const card = await repos.cards.create(newCard(item.id, ctx.clock.now()))
        return { itemId: item.id, cardId: card.id }
      })

      expect(await ctx.repos.knowledgeItems.findById(ids.itemId)).toBeDefined()
      expect(await ctx.repos.cards.findById(ids.cardId)).toBeDefined()
    })

    it('rolls back every write across several repositories when the work throws', async () => {
      // The writes below span two `await`s. A driver that committed at the first one would
      // leave the knowledge item behind — which is the failure this asserts against.
      await expect(
        ctx.repos.transaction(async (repos) => {
          const item = await repos.knowledgeItems.create(newItem())
          await repos.cards.create(newCard(item.id, ctx.clock.now()))
          throw new Error('rollback me')
        }),
      ).rejects.toThrow('rollback me')

      expect(await ctx.countRows('knowledge_items')).toBe(0)
      expect(await ctx.countRows('cards')).toBe(0)
    })

    it('sees its own writes inside the transaction', async () => {
      const found = await ctx.repos.transaction(async (repos) => {
        const item = await repos.knowledgeItems.create(newItem())
        return repos.knowledgeItems.findById(item.id)
      })
      expect(found).toBeDefined()
    })

    it('rolls a nested transaction back to its savepoint, leaving the outer one alive', async () => {
      const itemId = await ctx.repos.transaction(async (repos) => {
        const item = await repos.knowledgeItems.create(newItem())
        // Nested through the unit of work itself: the callback is handed `Repositories`,
        // which has no `transaction` — nesting is the unit of work's own concern, and the
        // adapter turns a nested call into a savepoint.
        await expect(
          ctx.repos.transaction(async (inner) => {
            await inner.knowledgeItems.create(newItem())
            throw new Error('inner')
          }),
        ).rejects.toThrow('inner')
        return item.id
      })

      // The outer write survived; the inner one did not.
      expect(await ctx.repos.knowledgeItems.findById(itemId)).toBeDefined()
      expect(await ctx.countRows('knowledge_items')).toBe(1)
    })

    it('commits a nested transaction as part of the outer one', async () => {
      await ctx.repos.transaction(async (repos) => {
        await repos.knowledgeItems.create(newItem())
        await ctx.repos.transaction(async (inner) => {
          await inner.knowledgeItems.create(newItem())
        })
      })
      expect(await ctx.countRows('knowledge_items')).toBe(2)
    })

    it('discards the outer transaction even when a nested one committed', async () => {
      await expect(
        ctx.repos.transaction(async () => {
          await ctx.repos.transaction(async (inner) => {
            await inner.knowledgeItems.create(newItem())
          })
          throw new Error('outer')
        }),
      ).rejects.toThrow('outer')
      expect(await ctx.countRows('knowledge_items')).toBe(0)
    })

    it('runs a transaction after a failed one', async () => {
      await expect(
        ctx.repos.transaction(async () => {
          throw new Error('first')
        }),
      ).rejects.toThrow('first')

      // A failed transaction must not wedge the connection for the next caller.
      await ctx.repos.transaction(async (repos) => {
        await repos.knowledgeItems.create(newItem())
      })
      expect(await ctx.countRows('knowledge_items')).toBe(1)
    })

    it('serialises overlapping transactions instead of interleaving them', async () => {
      // Started without awaiting the first: two `BEGIN`s on one connection would throw, and
      // the second callback's writes would otherwise land inside the first's transaction.
      const first = ctx.repos.transaction(async (repos) => {
        await repos.knowledgeItems.create(newItem())
      })
      const second = ctx.repos.transaction(async (repos) => {
        await repos.knowledgeItems.create(newItem())
      })
      await Promise.all([first, second])
      expect(await ctx.countRows('knowledge_items')).toBe(2)
    })
  })
}

function newItem() {
  return {
    lessonId: null,
    topicId: null,
    kind: 'fact' as const,
    fields: { front: 'q', back: 'a' },
    sourceId: null,
    annotationId: null,
    locator: null,
    asOf: null,
    importance: 'normal' as const,
    status: 'active' as const,
    createdBy: 'user' as const,
    tags: [],
  }
}

function newCard(itemId: string, due: Date) {
  return {
    itemId,
    template: 'basic',
    payload: null,
    due,
    stability: 0,
    difficulty: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: 0 as const,
    lastReview: null,
    suspended: false,
    buriedUntil: null,
    leech: false,
    importanceOverride: null,
    importanceOverrideExpiresAt: null,
    examId: null,
  }
}
