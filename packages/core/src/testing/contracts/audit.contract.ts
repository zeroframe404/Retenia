import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OptimisticConcurrencyError } from '../../ports/errors'
import type { ContractContext, RepositoryContractHarness } from '../harness'

/**
 * The rules `docs/spec/00-conventions.md` makes non-negotiable for every table: rows are
 * soft-deleted and never removed, `version` counts up on every write, and `updated_at`
 * never precedes `created_at`.
 *
 * Exercised through `knowledgeItems` because it is the simplest audited table with no
 * required parent — but the behaviour comes from the adapter's shared write path, so a
 * regression here is a regression everywhere.
 */
export function auditContract(harness: RepositoryContractHarness): void {
  describe('audit columns and soft deletes', () => {
    let ctx: ContractContext
    beforeEach(async () => {
      ctx = await harness.create()
    })
    afterEach(async () => {
      await ctx.dispose()
    })

    it('starts a new row at version 1 with created_at === updated_at', async () => {
      const item = await ctx.seed.knowledgeItem()
      expect(item.version).toBe(1)
      expect(item.updatedAt.getTime()).toBe(item.createdAt.getTime())
      expect(item.deletedAt).toBeNull()
      expect(item.deviceId).not.toBe('')
    })

    it('mints a UUIDv7 when the caller supplies no id', async () => {
      const item = await ctx.seed.knowledgeItem()
      expect(item.id).toHaveLength(36)
      // The version nibble: what the schema's `*_id_uuidv7` CHECK looks at.
      expect(item.id[14]).toBe('7')
    })

    it('increments version on every update', async () => {
      const item = await ctx.seed.knowledgeItem()
      const once = await ctx.repos.knowledgeItems.update(item.id, { topicId: 'a' })
      expect(once.version).toBe(2)
      const twice = await ctx.repos.knowledgeItems.update(item.id, { topicId: 'b' })
      expect(twice.version).toBe(3)
      expect(twice.topicId).toBe('b')
    })

    it('increments version on soft delete and on restore', async () => {
      const item = await ctx.seed.knowledgeItem()
      await ctx.repos.knowledgeItems.softDelete(item.id)
      const deleted = await ctx.repos.knowledgeItems.findById(item.id, { includeDeleted: true })
      expect(deleted?.version).toBe(2)
      await ctx.repos.knowledgeItems.restore(item.id)
      const restored = await ctx.repos.knowledgeItems.findById(item.id)
      expect(restored?.version).toBe(3)
    })

    it('hides a soft-deleted row from every read, but keeps it in storage', async () => {
      const item = await ctx.seed.knowledgeItem()
      const before = await ctx.countRows('knowledge_items')

      await ctx.repos.knowledgeItems.softDelete(item.id)

      expect(await ctx.repos.knowledgeItems.findById(item.id)).toBeUndefined()
      expect(await ctx.repos.knowledgeItems.findMany([item.id])).toEqual([])
      expect(await ctx.repos.knowledgeItems.list()).toEqual([])
      expect(await ctx.repos.knowledgeItems.count()).toBe(0)
      // The point of a soft delete: nothing left the table.
      expect(await ctx.countRows('knowledge_items')).toBe(before)
    })

    it('returns a soft-deleted row when explicitly asked for it', async () => {
      const item = await ctx.seed.knowledgeItem()
      await ctx.repos.knowledgeItems.softDelete(item.id)
      const found = await ctx.repos.knowledgeItems.findById(item.id, { includeDeleted: true })
      expect(found?.id).toBe(item.id)
      expect(found?.deletedAt).toBeInstanceOf(Date)
    })

    it('brings a row back on restore', async () => {
      const item = await ctx.seed.knowledgeItem()
      await ctx.repos.knowledgeItems.softDelete(item.id)
      await ctx.repos.knowledgeItems.restore(item.id)
      const restored = await ctx.repos.knowledgeItems.findById(item.id)
      expect(restored?.deletedAt).toBeNull()
    })

    it('treats deleting an already-deleted row as a no-op', async () => {
      const item = await ctx.seed.knowledgeItem()
      await ctx.repos.knowledgeItems.softDelete(item.id)
      await ctx.repos.knowledgeItems.softDelete(item.id)
      const deleted = await ctx.repos.knowledgeItems.findById(item.id, { includeDeleted: true })
      // The second call must not bump the version again.
      expect(deleted?.version).toBe(2)
    })

    it('refuses to update a soft-deleted row', async () => {
      const item = await ctx.seed.knowledgeItem()
      await ctx.repos.knowledgeItems.softDelete(item.id)
      await expect(ctx.repos.knowledgeItems.update(item.id, { topicId: 'x' })).rejects.toThrow()
    })

    it('rejects a stale version and changes nothing', async () => {
      const item = await ctx.seed.knowledgeItem()
      await ctx.repos.knowledgeItems.update(item.id, { topicId: 'first' })

      await expect(
        ctx.repos.knowledgeItems.update(item.id, { topicId: 'second', version: 1 }),
      ).rejects.toBeInstanceOf(OptimisticConcurrencyError)

      const unchanged = await ctx.repos.knowledgeItems.findById(item.id)
      expect(unchanged?.topicId).toBe('first')
      expect(unchanged?.version).toBe(2)
    })

    it('accepts a matching version', async () => {
      const item = await ctx.seed.knowledgeItem()
      const updated = await ctx.repos.knowledgeItems.update(item.id, {
        topicId: 'ok',
        version: item.version,
      })
      expect(updated.topicId).toBe('ok')
    })

    it('moves updated_at forward with the clock', async () => {
      const item = await ctx.seed.knowledgeItem()
      ctx.clock.advance(60_000)
      const updated = await ctx.repos.knowledgeItems.update(item.id, { topicId: 'later' })
      expect(updated.updatedAt.getTime()).toBe(item.createdAt.getTime() + 60_000)
    })

    it('never lets updated_at fall behind created_at when the clock steps back', async () => {
      const item = await ctx.seed.knowledgeItem()
      // A user correcting their system clock, or DST on a machine that stores local time.
      ctx.clock.advance(-60_000)
      const updated = await ctx.repos.knowledgeItems.update(item.id, { topicId: 'earlier' })
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(updated.createdAt.getTime())
    })

    it('inserts through save when the id is unknown, updates when it is known', async () => {
      const item = await ctx.seed.knowledgeItem()
      const inserted = await ctx.repos.knowledgeItems.save({
        ...item,
        id: ctx.ids.next(),
        topicId: 'new',
      })
      expect(inserted.version).toBe(1)
      expect(inserted.topicId).toBe('new')

      const updated = await ctx.repos.knowledgeItems.save({ ...item, topicId: 'changed' })
      expect(updated.id).toBe(item.id)
      expect(updated.version).toBe(2)
      expect(updated.topicId).toBe('changed')
    })
  })
}
