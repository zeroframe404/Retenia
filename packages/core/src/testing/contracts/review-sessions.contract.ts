import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReviewSession } from '../../entities'
import type { NewEntity } from '../../ports/audit'
import type { ContractContext, RepositoryContractHarness } from '../harness'

/**
 * `review_sessions` (`docs/spec/02-memory-system.md` §12): the row that lets a daily session
 * survive the app being closed.
 *
 * What the adapter has to get right is the *resume* path — exactly one session is open at a
 * time, `findActive` returns it, and a session left open on an earlier day is abandoned
 * rather than resumed into.
 */
export function reviewSessionsContract(harness: RepositoryContractHarness): void {
  describe('review sessions', () => {
    let ctx: ContractContext
    beforeEach(async () => {
      ctx = await harness.create()
    })
    afterEach(async () => {
      await ctx.dispose()
    })

    const draft = (
      overrides: Partial<NewEntity<ReviewSession>> = {},
    ): NewEntity<ReviewSession> => ({
      status: 'in_progress',
      startedAt: ctx.clock.now(),
      finishedAt: null,
      durationMs: null,
      seed: '20734',
      plan: { entries: [], studyDay: 20734 },
      progress: { cursor: 0, outcomes: [], drill: [], drillStarted: false },
      reviewed: 0,
      again: 0,
      hard: 0,
      postponed: 0,
      accuracy: null,
      xp: 0,
      summary: null,
      ...overrides,
    })

    it('round-trips the frozen plan and the progress cursor', async () => {
      const created = await ctx.repos.reviewSessions.create(
        draft({
          plan: { entries: [{ kind: 'due', cardId: 'c1' }], studyDay: 20734 },
          progress: { cursor: 3, outcomes: [{ cardId: 'c1', logId: 'l1' }], drill: ['c1'] },
        }),
      )
      const read = await ctx.repos.reviewSessions.findById(created.id)
      expect(read?.plan).toEqual({ entries: [{ kind: 'due', cardId: 'c1' }], studyDay: 20734 })
      expect(read?.progress).toEqual({
        cursor: 3,
        outcomes: [{ cardId: 'c1', logId: 'l1' }],
        drill: ['c1'],
      })
      expect(read?.seed).toBe('20734')
    })

    it('findActive returns the open session, and nothing once it is finished', async () => {
      expect(await ctx.repos.reviewSessions.findActive()).toBeUndefined()
      const created = await ctx.repos.reviewSessions.create(draft())
      expect((await ctx.repos.reviewSessions.findActive())?.id).toBe(created.id)

      await ctx.repos.reviewSessions.update(created.id, {
        status: 'completed',
        finishedAt: ctx.clock.now(),
      })
      expect(await ctx.repos.reviewSessions.findActive()).toBeUndefined()
    })

    it('findActive prefers the newest session, so a crashed row never shadows a newer one', async () => {
      await ctx.repos.reviewSessions.create(draft())
      ctx.clock.advance(60_000)
      const newer = await ctx.repos.reviewSessions.create(draft({ startedAt: ctx.clock.now() }))
      expect((await ctx.repos.reviewSessions.findActive())?.id).toBe(newer.id)
    })

    it('abandonStale closes sessions started before the cutoff, and is idempotent', async () => {
      const yesterday = await ctx.repos.reviewSessions.create(draft())
      ctx.clock.advance(24 * 60 * 60 * 1000)
      const cutoff = ctx.clock.now()
      const today = await ctx.repos.reviewSessions.create(draft({ startedAt: cutoff }))

      expect(await ctx.repos.reviewSessions.abandonStale(cutoff)).toBe(1)
      expect((await ctx.repos.reviewSessions.findById(yesterday.id))?.status).toBe('abandoned')
      expect((await ctx.repos.reviewSessions.findById(today.id))?.status).toBe('in_progress')

      // Nothing left to close: a second sweep is a no-op, not a second write.
      expect(await ctx.repos.reviewSessions.abandonStale(cutoff)).toBe(0)
      expect((await ctx.repos.reviewSessions.findActive())?.id).toBe(today.id)
    })

    it('listSince returns sessions in the window, newest first', async () => {
      const first = await ctx.repos.reviewSessions.create(draft())
      const from = ctx.clock.now()
      ctx.clock.advance(60_000)
      const second = await ctx.repos.reviewSessions.create(draft({ startedAt: ctx.clock.now() }))

      const rows = await ctx.repos.reviewSessions.listSince(from)
      expect(rows.map((row) => row.id)).toEqual([second.id, first.id])
      expect(
        await ctx.repos.reviewSessions.listSince(new Date(from.getTime() + 30_000)),
      ).toHaveLength(1)
    })

    it('soft-deletes like every other table', async () => {
      const created = await ctx.repos.reviewSessions.create(draft())
      await ctx.repos.reviewSessions.softDelete(created.id)
      expect(await ctx.repos.reviewSessions.findById(created.id)).toBeUndefined()
      expect(await ctx.repos.reviewSessions.findActive()).toBeUndefined()
      expect(await ctx.countRows('review_sessions')).toBe(1)
    })
  })
}
