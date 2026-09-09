import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ContractContext, RepositoryContractHarness } from '../harness'

/** The run ledger of sub-phase 8.1: creation, the two listings a resume and a path screen
 *  need, and the stage transitions that carry the manifest and warnings. */
export function generationRunsContract(harness: RepositoryContractHarness): void {
  describe('generation runs', () => {
    let ctx: ContractContext
    beforeEach(async () => {
      ctx = await harness.create()
    })
    afterEach(async () => {
      await ctx.dispose()
    })

    it('creates a queued run holding its config and config hash', async () => {
      const run = await ctx.seed.generationRun()
      expect(run).toMatchObject({
        status: 'queued',
        pathVersionId: null,
        costUsd: 0,
        warnings: [],
        manifest: null,
        finishedAt: null,
      })
      expect(run.config).toEqual(expect.objectContaining({ goal: expect.any(String) }))
      expect(run.configHash).toHaveLength(64)
    })

    it('lists the runs of one path newest first, and finds the latest', async () => {
      const path = await ctx.seed.path()
      const first = await ctx.seed.generationRun({ pathId: path.id })
      ctx.clock.advance(1_000)
      const second = await ctx.seed.generationRun({ pathId: path.id })
      // Another path's run must not leak into the listing.
      await ctx.seed.generationRun()

      const runs = await ctx.repos.generationRuns.listByPath(path.id)
      expect(runs.map((run) => run.id)).toEqual([second.id, first.id])
      expect((await ctx.repos.generationRuns.findLatestByPath(path.id))?.id).toBe(second.id)
      expect(await ctx.repos.generationRuns.findLatestByPath('no-such-path')).toBeUndefined()
    })

    it('lists active runs oldest first, counting a budget pause as active', async () => {
      const extracting = await ctx.seed.generationRun({ status: 'extracting' })
      ctx.clock.advance(1_000)
      const paused = await ctx.seed.generationRun({ status: 'blocked_budget' })
      ctx.clock.advance(1_000)
      await ctx.seed.generationRun({ status: 'completed' })
      await ctx.seed.generationRun({ status: 'failed' })
      await ctx.seed.generationRun({ status: 'cancelled' })

      const active = await ctx.repos.generationRuns.listActive()
      expect(active.map((run) => run.id)).toEqual([extracting.id, paused.id])
    })

    it('moves a run to completed with its version, manifest, warnings and totals', async () => {
      const run = await ctx.seed.generationRun({ status: 'sequencing' })
      const version = await ctx.seed.pathVersion({ pathId: run.pathId })
      const finishedAt = ctx.clock.now()

      const updated = await ctx.repos.generationRuns.update(run.id, {
        status: 'completed',
        pathVersionId: version.id,
        manifest: { version: 1, prompt_versions: { P1_extract_chunk: '1' } },
        warnings: [{ code: 'cycle_broken', stage: 'validate', params: { from: 'a', to: 'b' } }],
        costUsd: 0.42,
        inputTokens: 1_000,
        outputTokens: 200,
        cachedTokens: 50,
        finishedAt,
      })

      expect(updated).toMatchObject({
        status: 'completed',
        pathVersionId: version.id,
        costUsd: 0.42,
        inputTokens: 1_000,
        outputTokens: 200,
        cachedTokens: 50,
      })
      expect(updated.manifest).toEqual({ version: 1, prompt_versions: { P1_extract_chunk: '1' } })
      expect(updated.warnings).toEqual([
        { code: 'cycle_broken', stage: 'validate', params: { from: 'a', to: 'b' } },
      ])
      expect(updated.finishedAt?.getTime()).toBe(finishedAt.getTime())
      expect(updated.version).toBe(run.version + 1)
    })

    it('refuses a status outside the vocabulary', async () => {
      if (!ctx.capabilities.checkConstraints) return
      const run = await ctx.seed.generationRun()
      await expect(
        ctx.repos.generationRuns.update(run.id, { status: 'dreaming' as never }),
      ).rejects.toThrow()
    })

    it('soft-deletes rather than removing the row', async () => {
      const run = await ctx.seed.generationRun()
      await ctx.repos.generationRuns.softDelete(run.id)
      expect(await ctx.repos.generationRuns.findById(run.id)).toBeUndefined()
      expect(await ctx.repos.generationRuns.listActive()).toEqual([])
      expect(await ctx.countRows('generation_runs')).toBe(1)
    })
  })
}
