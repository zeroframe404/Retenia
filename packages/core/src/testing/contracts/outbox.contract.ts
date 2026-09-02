import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ContractContext, RepositoryContractHarness } from '../harness'

/**
 * The sync outbox (`docs/spec/07-architecture.md` §6).
 *
 * It stays empty in v1 — there is nothing to sync to — but it is written and tested now so
 * that turning sync on later is a flag rather than a migration and a rewrite. These tests
 * are what make "we will not have to rewrite the data layer when we commercialise" a claim
 * with evidence behind it.
 */
export function outboxContract(harness: RepositoryContractHarness): void {
  describe('sync outbox', () => {
    describe('with the flag off (the v1 default)', () => {
      let ctx: ContractContext
      beforeEach(async () => {
        ctx = await harness.create()
      })
      afterEach(async () => {
        await ctx.dispose()
      })

      it('leaves the outbox empty however much is written', async () => {
        const item = await ctx.seed.knowledgeItem()
        await ctx.repos.knowledgeItems.update(item.id, { topicId: 'x' })
        await ctx.repos.knowledgeItems.softDelete(item.id)
        await ctx.repos.knowledgeItems.restore(item.id)
        await ctx.seed.card()

        expect(await ctx.listOutbox()).toEqual([])
        expect(await ctx.repos.outbox.countPending()).toBe(0)
      })
    })

    describe('with the flag on', () => {
      let ctx: ContractContext
      beforeEach(async () => {
        ctx = await harness.create({ outboxEnabled: true })
      })
      afterEach(async () => {
        await ctx.dispose()
      })

      it('appends one insert row carrying the new version', async () => {
        const item = await ctx.seed.knowledgeItem()
        const entries = (await ctx.listOutbox()).filter(
          (entry) => entry.tableName === 'knowledge_items',
        )
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({
          tableName: 'knowledge_items',
          rowId: item.id,
          op: 'insert',
          rowVersion: 1,
          syncedAt: null,
          attempts: 0,
        })
      })

      it('records the post-update version, not the pre-update one', async () => {
        const item = await ctx.seed.knowledgeItem()
        await ctx.repos.knowledgeItems.update(item.id, { topicId: 'x' })
        const entries = await ctx.repos.outbox.listForRow('knowledge_items', item.id)
        expect(entries.map((entry) => [entry.op, entry.rowVersion])).toEqual([
          ['insert', 1],
          ['update', 2],
        ])
      })

      it('records a soft delete as a delete', async () => {
        const item = await ctx.seed.knowledgeItem()
        await ctx.repos.knowledgeItems.softDelete(item.id)
        const entries = await ctx.repos.outbox.listForRow('knowledge_items', item.id)
        expect(entries.at(-1)).toMatchObject({ op: 'delete', rowVersion: 2 })
      })

      it('never mirrors the outbox into itself', async () => {
        await ctx.seed.knowledgeItem()
        const entries = await ctx.listOutbox()
        expect(entries.some((entry) => entry.tableName === 'outbox')).toBe(false)
      })

      it('does not mirror the device-local tables', async () => {
        // A job queued here means nothing on another device, and the AI cost log follows
        // the machine that spent the money.
        await ctx.repos.jobs.enqueue('ingest', { sourceId: 'x' })
        await ctx.repos.aiCalls.record({
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          role: 'smart',
          purpose: 'lesson_expansion',
          status: 'ok',
          inputTokens: 10,
          outputTokens: 20,
          cachedInputTokens: 0,
          reasoningTokens: 0,
          costUsd: 0.01,
          latencyMs: 100,
          batchId: null,
          customId: null,
          promptVersion: null,
          schemaVersion: null,
          temperature: null,
          jobId: null,
          error: null,
          meta: null,
        })
        const tables = new Set((await ctx.listOutbox()).map((entry) => entry.tableName))
        expect(tables.has('jobs')).toBe(false)
        expect(tables.has('ai_calls')).toBe(false)
      })

      it('emits rows for the children a source soft delete cascades to in SQL', async () => {
        // `sources_soft_delete_cascade` (migration 0001) soft-deletes the source's units and
        // chunks inside the database, so those writes never pass through a repository. If
        // the source repository did not read them back and emit for them, a future sync
        // would lose every chunk of a deleted book.
        const source = await ctx.seed.source()
        const chunk = await ctx.seed.chunk({ sourceId: source.id })

        await ctx.repos.sources.softDelete(source.id)

        const chunkEntries = await ctx.repos.outbox.listForRow('chunks', chunk.id)
        expect(chunkEntries.at(-1)).toMatchObject({ op: 'delete' })
        // The cascade bumps the child's version too, and the outbox must agree with it.
        const cascaded = await ctx.repos.chunks.findById(chunk.id, { includeDeleted: true })
        expect(chunkEntries.at(-1)?.rowVersion).toBe(cascaded?.version)
      })

      it('emits rows for the children a source restore brings back', async () => {
        const source = await ctx.seed.source()
        const chunk = await ctx.seed.chunk({ sourceId: source.id })
        await ctx.repos.sources.softDelete(source.id)

        await ctx.repos.sources.restore(source.id)

        const chunkEntries = await ctx.repos.outbox.listForRow('chunks', chunk.id)
        expect(chunkEntries.at(-1)).toMatchObject({ op: 'update' })
        expect(await ctx.repos.chunks.findById(chunk.id)).toBeDefined()
      })

      it('leaves nothing behind when the transaction that wrote it rolls back', async () => {
        await expect(
          ctx.repos.transaction(async (repos) => {
            await repos.knowledgeItems.create(newItem())
            throw new Error('boom')
          }),
        ).rejects.toThrow('boom')

        expect(await ctx.listOutbox()).toEqual([])
      })

      it('marks entries synced without enqueuing more', async () => {
        const item = await ctx.seed.knowledgeItem()
        const pending = await ctx.repos.outbox.listPending()
        expect(pending.length).toBeGreaterThan(0)

        await ctx.repos.outbox.markSynced(
          pending.map((entry) => entry.id),
          ctx.clock.now(),
        )

        expect(await ctx.repos.outbox.countPending()).toBe(0)
        // Draining the outbox must not append to it — otherwise sync never terminates.
        expect((await ctx.listOutbox()).length).toBe(pending.length)
        expect(item.id).toBeDefined()
      })

      it('counts a failed push without losing the entry', async () => {
        await ctx.seed.knowledgeItem()
        const [first] = await ctx.repos.outbox.listPending()
        if (first === undefined) throw new Error('expected a pending entry')

        await ctx.repos.outbox.recordFailure(first.id, 'network unreachable')

        const [after] = await ctx.repos.outbox.listPending()
        expect(after).toMatchObject({ attempts: 1, error: 'network unreachable' })
      })
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
