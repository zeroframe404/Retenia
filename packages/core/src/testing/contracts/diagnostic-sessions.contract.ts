import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DiagnosticSession, JsonObject } from '../../entities'
import type { NewEntity } from '../../ports/audit'
import type { ContractContext, RepositoryContractHarness } from '../harness'

/**
 * `diagnostic_sessions` (`docs/spec/04-path-generation.md` §10, sub-phase 8.5), plus the
 * `item_bank.authoring` column the diagnostic's item build writes.
 *
 * What the adapter has to get right is the *resume* path — `findActive` returns the open
 * session of one path version and nothing else — and that the JSON the engine replays comes
 * back exactly as it went in.
 */
export function diagnosticSessionsContract(harness: RepositoryContractHarness): void {
  describe('diagnostic sessions', () => {
    let ctx: ContractContext
    beforeEach(async () => {
      ctx = await harness.create()
    })
    afterEach(async () => {
      await ctx.dispose()
    })

    const draft = (
      pathVersionId: string,
      overrides: Partial<NewEntity<DiagnosticSession>> = {},
    ): NewEntity<DiagnosticSession> => ({
      pathVersionId,
      status: 'in_progress',
      entry: 'partial',
      selfAssessment: {},
      answers: [],
      pending: null,
      result: null,
      applied: {},
      stopReason: null,
      startedAt: ctx.clock.now(),
      finishedAt: null,
      ...overrides,
    })

    it('round-trips the self-assessment, answer log, pending item, result and applied record', async () => {
      const version = await ctx.seed.pathVersion()
      const answers = [
        {
          itemId: 'item-1',
          outcome: 'correct',
          confidence: 'sure',
          timeMs: 4_200,
          difficulty: -0.4,
          chosenOptionId: 'b',
        },
        {
          itemId: 'item-2',
          outcome: 'skipped',
          confidence: null,
          timeMs: 900,
          difficulty: 0.8,
          chosenOptionId: null,
        },
      ]
      const pending = { itemBankId: 'item-3', attemptId: 'attempt-3', difficulty: 0.3 }
      const created = await ctx.repos.diagnosticSessions.create(
        draft(version.id, {
          selfAssessment: { S01: 'know', S02: 'never' },
          answers,
          pending: { ...pending, servedAt: 1_789_000_000_000 },
        }),
      )

      const read = await ctx.repos.diagnosticSessions.findById(created.id)
      expect(read).toMatchObject({
        pathVersionId: version.id,
        status: 'in_progress',
        entry: 'partial',
        result: null,
        stopReason: null,
        finishedAt: null,
      })
      expect(read?.selfAssessment).toEqual({ S01: 'know', S02: 'never' })
      expect(read?.answers).toEqual(answers)
      expect(read?.pending).toEqual({ ...pending, servedAt: 1_789_000_000_000 })
      expect(read?.applied).toEqual({})
      expect(read?.startedAt.getTime()).toBe(created.startedAt.getTime())

      const result: JsonObject = {
        modules: [{ id: 'M01', status: 'known', p: 0.91, source: 'diagnostic' }],
        itemsAsked: 2,
      }
      const applied: JsonObject = { completedLessonIds: ['L01'], seededCardIds: ['c1', 'c2'] }
      const finishedAt = ctx.clock.now()
      const done = await ctx.repos.diagnosticSessions.update(created.id, {
        status: 'completed',
        pending: null,
        result,
        applied,
        stopReason: 'all_classified',
        finishedAt,
      })
      expect(done.version).toBe(created.version + 1)

      const reread = await ctx.repos.diagnosticSessions.findById(created.id)
      expect(reread).toMatchObject({ status: 'completed', stopReason: 'all_classified' })
      expect(reread?.pending).toBeNull()
      expect(reread?.result).toEqual(result)
      expect(reread?.applied).toEqual(applied)
      expect(reread?.answers).toEqual(answers)
      expect(reread?.finishedAt?.getTime()).toBe(finishedAt.getTime())
    })

    it('findActive returns the open session of that version only, never a completed or soft-deleted one', async () => {
      const version = await ctx.seed.pathVersion()
      const other = await ctx.seed.pathVersion()
      expect(await ctx.repos.diagnosticSessions.findActive(version.id)).toBeUndefined()

      await ctx.repos.diagnosticSessions.create(
        draft(version.id, {
          status: 'completed',
          stopReason: 'max_items',
          finishedAt: ctx.clock.now(),
        }),
      )
      // Another version's open session must not leak into this one's.
      const elsewhere = await ctx.repos.diagnosticSessions.create(draft(other.id))
      expect(await ctx.repos.diagnosticSessions.findActive(version.id)).toBeUndefined()
      expect((await ctx.repos.diagnosticSessions.findActive(other.id))?.id).toBe(elsewhere.id)

      const open = await ctx.repos.diagnosticSessions.create(draft(version.id))
      expect((await ctx.repos.diagnosticSessions.findActive(version.id))?.id).toBe(open.id)

      await ctx.repos.diagnosticSessions.softDelete(open.id)
      expect(await ctx.repos.diagnosticSessions.findActive(version.id)).toBeUndefined()
      expect(await ctx.countRows('diagnostic_sessions')).toBe(3)
    })

    it('findActive prefers the newest open session, so a crashed row never shadows a newer one', async () => {
      const version = await ctx.seed.pathVersion()
      await ctx.repos.diagnosticSessions.create(draft(version.id))
      ctx.clock.advance(60_000)
      const newer = await ctx.repos.diagnosticSessions.create(
        draft(version.id, { startedAt: ctx.clock.now() }),
      )
      expect((await ctx.repos.diagnosticSessions.findActive(version.id))?.id).toBe(newer.id)
    })

    it("listByPathVersion returns one version's sessions oldest first", async () => {
      const version = await ctx.seed.pathVersion()
      const other = await ctx.seed.pathVersion()
      ctx.clock.advance(1_000)
      const second = await ctx.repos.diagnosticSessions.create(
        draft(version.id, { startedAt: ctx.clock.now() }),
      )
      // Created later but started earlier: the order is `startedAt`, not insertion.
      const first = await ctx.repos.diagnosticSessions.create(
        draft(version.id, {
          entry: 'preview',
          status: 'completed',
          startedAt: new Date(ctx.clock.now().getTime() - 60_000),
          finishedAt: ctx.clock.now(),
        }),
      )
      await ctx.repos.diagnosticSessions.create(draft(other.id))

      const rows = await ctx.repos.diagnosticSessions.listByPathVersion(version.id)
      expect(rows.map((row) => row.id)).toEqual([first.id, second.id])
      expect(
        (await ctx.repos.diagnosticSessions.listByPathVersion(version.id, { limit: 1 })).map(
          (row) => row.id,
        ),
      ).toEqual([first.id])
    })

    it('listByStatus spans path versions, oldest first', async () => {
      const version = await ctx.seed.pathVersion()
      const other = await ctx.seed.pathVersion()
      const a = await ctx.repos.diagnosticSessions.create(draft(version.id))
      ctx.clock.advance(1_000)
      const b = await ctx.repos.diagnosticSessions.create(
        draft(other.id, {
          status: 'completed',
          stopReason: 'time_limit',
          startedAt: ctx.clock.now(),
          finishedAt: ctx.clock.now(),
        }),
      )
      ctx.clock.advance(1_000)
      const c = await ctx.repos.diagnosticSessions.create(
        draft(other.id, { startedAt: ctx.clock.now() }),
      )

      expect(
        (await ctx.repos.diagnosticSessions.listByStatus('in_progress')).map((row) => row.id),
      ).toEqual([a.id, c.id])
      expect(
        (await ctx.repos.diagnosticSessions.listByStatus('completed')).map((row) => row.id),
      ).toEqual([b.id])
    })

    it('refuses a status, entry or stop reason outside the vocabulary', async () => {
      if (!ctx.capabilities.checkConstraints) return
      const version = await ctx.seed.pathVersion()
      await expect(
        ctx.repos.diagnosticSessions.create(draft(version.id, { entry: 'guess' as never })),
      ).rejects.toThrow()
      const session = await ctx.repos.diagnosticSessions.create(draft(version.id))
      await expect(
        ctx.repos.diagnosticSessions.update(session.id, { status: 'abandoned' as never }),
      ).rejects.toThrow()
      await expect(
        ctx.repos.diagnosticSessions.update(session.id, { stopReason: 'bored' as never }),
      ).rejects.toThrow()
    })
  })

  describe('item bank authoring', () => {
    let ctx: ContractContext
    beforeEach(async () => {
      ctx = await harness.create()
    })
    afterEach(async () => {
      await ctx.dispose()
    })

    it('round-trips what P9 said about the item, and patches it', async () => {
      const activity = await ctx.seed.activity()
      const authoring: JsonObject = {
        cell_key: 'M01|c-heart|recall|A',
        kind: 'recall',
        form: 'A',
        difficulty: 2,
        stem: '¿Cuántas cavidades tiene el corazón?',
        concept_ids: ['c-heart'],
        misconception_by_option: { b: 'mc-three-chambers' },
      }
      const created = await ctx.repos.itemBank.create({
        activityId: activity.id,
        pathVersionId: null,
        moduleId: null,
        usage: ['diagnostic'],
        difficultyLogit: -0.8,
        discriminationHint: null,
        exposure: 0,
        stats: {},
        authoring,
      })
      expect((await ctx.repos.itemBank.findById(created.id))?.authoring).toEqual(authoring)

      const patched = await ctx.repos.itemBank.update(created.id, {
        authoring: { ...authoring, difficulty: 3 },
      })
      expect(patched.authoring).toEqual({ ...authoring, difficulty: 3 })
      // A patch that does not mention it leaves it alone.
      const bumped = await ctx.repos.itemBank.update(created.id, { exposure: 1 })
      expect(bumped.authoring).toEqual({ ...authoring, difficulty: 3 })
    })
  })
}
