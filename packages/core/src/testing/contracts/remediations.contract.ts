import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { JsonObject, Remediation } from '../../entities'
import type { NewEntity } from '../../ports/audit'
import type { ContractContext, RepositoryContractHarness } from '../harness'

/**
 * `remediations` (`docs/spec/04-path-generation.md` §11, sub-phase 8.6): the remediation log.
 *
 * What the adapter has to get right is the four reads the limits and the sweeps make —
 * `listByPathVersion`, `listByPathId`, `listByStatus`, `listSince` and `findByLesson` — plus
 * that the JSON
 * evidence/boost/outcome and the nullable `resolvedAt`/`refusal` round-trip exactly.
 */
export function remediationsContract(harness: RepositoryContractHarness): void {
  describe('remediations', () => {
    let ctx: ContractContext
    beforeEach(async () => {
      ctx = await harness.create()
    })
    afterEach(async () => {
      await ctx.dispose()
    })

    const draft = (
      pathVersionId: string,
      moduleId: string,
      overrides: Partial<NewEntity<Remediation>> = {},
    ): NewEntity<Remediation> => ({
      pathVersionId,
      moduleId,
      conceptId: 'c-heart',
      misconceptionId: null,
      trigger: 'memory_lapses',
      status: 'active',
      refusal: null,
      anchorLessonId: null,
      lessonId: null,
      specId: null,
      evidence: {},
      boost: {},
      outcome: null,
      resolvedAt: null,
      ...overrides,
    })

    it('round-trips the evidence, boost and outcome JSON and the nullable fields', async () => {
      const version = await ctx.seed.pathVersion()
      const module_ = await ctx.seed.module()
      const lesson = await ctx.seed.lesson({ moduleId: module_.id })
      const evidence: JsonObject = { lapses: 3, window_days: 14 }
      const boost: JsonObject = { card_ids: ['c1', 'c2'], expires_at: 1_789_000_000_000 }

      const created = await ctx.repos.remediations.create(
        draft(version.id, module_.id, {
          misconceptionId: 'mc-three-chambers',
          anchorLessonId: lesson.id,
          specId: 'L01.r1',
          evidence,
          boost,
        }),
      )

      const read = await ctx.repos.remediations.findById(created.id)
      expect(read).toMatchObject({
        pathVersionId: version.id,
        moduleId: module_.id,
        conceptId: 'c-heart',
        misconceptionId: 'mc-three-chambers',
        trigger: 'memory_lapses',
        status: 'active',
        refusal: null,
        anchorLessonId: lesson.id,
        lessonId: null,
        specId: 'L01.r1',
      })
      expect(read?.evidence).toEqual(evidence)
      expect(read?.boost).toEqual(boost)
      expect(read?.outcome).toBeNull()
      expect(read?.resolvedAt).toBeNull()

      // A refused row carries its refusal; a resolved one carries a `resolvedAt`.
      const resolvedAt = ctx.clock.now()
      const outcome: JsonObject = { attempts: 4, correct: 3, accuracy: 0.75 }
      const refused = await ctx.repos.remediations.create(
        draft(version.id, module_.id, {
          status: 'refused',
          refusal: 'weekly_limit',
          resolvedAt,
          outcome,
        }),
      )
      const rereadRefused = await ctx.repos.remediations.findById(refused.id)
      expect(rereadRefused?.status).toBe('refused')
      expect(rereadRefused?.refusal).toBe('weekly_limit')
      expect(rereadRefused?.outcome).toEqual(outcome)
      expect(rereadRefused?.resolvedAt?.getTime()).toBe(resolvedAt.getTime())
    })

    it("listByPathVersion returns only that version's rows, oldest createdAt first", async () => {
      const version = await ctx.seed.pathVersion()
      const other = await ctx.seed.pathVersion()
      const module_ = await ctx.seed.module()

      const first = await ctx.repos.remediations.create(draft(version.id, module_.id))
      ctx.clock.advance(1_000)
      const second = await ctx.repos.remediations.create(draft(version.id, module_.id))
      ctx.clock.advance(1_000)
      await ctx.repos.remediations.create(draft(other.id, module_.id))

      const rows = await ctx.repos.remediations.listByPathVersion(version.id)
      expect(rows.map((row) => row.id)).toEqual([first.id, second.id])
    })

    it("listByPathId returns every version's rows of the same path, oldest createdAt first, and excludes other paths", async () => {
      const path = await ctx.seed.path()
      const versionA = await ctx.seed.pathVersion({ pathId: path.id })
      const versionB = await ctx.seed.pathVersion({ pathId: path.id })
      const otherPathVersion = await ctx.seed.pathVersion()
      const module_ = await ctx.seed.module()

      // A regeneration only retires a superseded version's open detours (`dismissed`); the
      // row itself, and its earlier `completed` sibling, stay — this is what must still count.
      const onOldVersion = await ctx.repos.remediations.create(
        draft(versionA.id, module_.id, { status: 'completed', resolvedAt: ctx.clock.now() }),
      )
      ctx.clock.advance(1_000)
      const onNewVersion = await ctx.repos.remediations.create(draft(versionB.id, module_.id))
      ctx.clock.advance(1_000)
      await ctx.repos.remediations.create(draft(otherPathVersion.id, module_.id))

      const rows = await ctx.repos.remediations.listByPathId(path.id)
      expect(rows.map((row) => row.id)).toEqual([onOldVersion.id, onNewVersion.id])
    })

    it('listByStatus filters by any of the given statuses, and [] returns []', async () => {
      const version = await ctx.seed.pathVersion()
      const module_ = await ctx.seed.module()

      const active = await ctx.repos.remediations.create(draft(version.id, module_.id))
      ctx.clock.advance(1_000)
      const completed = await ctx.repos.remediations.create(
        draft(version.id, module_.id, { status: 'completed', resolvedAt: ctx.clock.now() }),
      )
      ctx.clock.advance(1_000)
      await ctx.repos.remediations.create(draft(version.id, module_.id, { status: 'dismissed' }))

      expect(
        (await ctx.repos.remediations.listByStatus(['active', 'completed'])).map((r) => r.id),
      ).toEqual([active.id, completed.id])
      expect(await ctx.repos.remediations.listByStatus([])).toEqual([])
    })

    it('listSince includes rows created at `from` and later, excludes earlier ones', async () => {
      const version = await ctx.seed.pathVersion()
      const module_ = await ctx.seed.module()

      await ctx.repos.remediations.create(draft(version.id, module_.id))
      ctx.clock.advance(1_000)
      const from = ctx.clock.now()
      const atBoundary = await ctx.repos.remediations.create(draft(version.id, module_.id))
      ctx.clock.advance(1_000)
      const after = await ctx.repos.remediations.create(draft(version.id, module_.id))

      const rows = await ctx.repos.remediations.listSince(from)
      expect(rows.map((row) => row.id)).toEqual([atBoundary.id, after.id])
    })

    it('findByLesson finds the remediation that wrote a lesson, undefined for an unknown one', async () => {
      const version = await ctx.seed.pathVersion()
      const module_ = await ctx.seed.module()
      const anchor = await ctx.seed.lesson({ moduleId: module_.id })
      const detour = await ctx.seed.lesson({
        moduleId: module_.id,
        kind: 'remediation',
        parentLessonId: anchor.id,
        specId: 'L01.r1',
      })

      expect(await ctx.repos.remediations.findByLesson(detour.id)).toBeUndefined()

      const created = await ctx.repos.remediations.create(
        draft(version.id, module_.id, { anchorLessonId: anchor.id, lessonId: detour.id }),
      )
      expect((await ctx.repos.remediations.findByLesson(detour.id))?.id).toBe(created.id)
      expect(await ctx.repos.remediations.findByLesson(anchor.id)).toBeUndefined()
    })

    it('excludes soft-deleted rows from listByPathVersion, listByPathId, listByStatus, listSince and findByLesson', async () => {
      const version = await ctx.seed.pathVersion()
      const module_ = await ctx.seed.module()
      const lesson = await ctx.seed.lesson({ moduleId: module_.id })
      const from = ctx.clock.now()
      const created = await ctx.repos.remediations.create(
        draft(version.id, module_.id, { lessonId: lesson.id }),
      )

      await ctx.repos.remediations.softDelete(created.id)

      expect(await ctx.repos.remediations.listByPathVersion(version.id)).toEqual([])
      expect(await ctx.repos.remediations.listByPathId(version.pathId)).toEqual([])
      expect(await ctx.repos.remediations.listByStatus(['active'])).toEqual([])
      expect(await ctx.repos.remediations.listSince(from)).toEqual([])
      expect(await ctx.repos.remediations.findByLesson(lesson.id)).toBeUndefined()
      expect(await ctx.countRows('remediations')).toBe(1)
    })

    it('update of status, boost and outcome persists and bumps version', async () => {
      const version = await ctx.seed.pathVersion()
      const module_ = await ctx.seed.module()
      const created = await ctx.repos.remediations.create(draft(version.id, module_.id))

      const boost: JsonObject = { card_ids: ['c1'], expires_at: 1_789_100_000_000 }
      const outcome: JsonObject = { attempts: 2, correct: 2, accuracy: 1 }
      const resolvedAt = ctx.clock.now()
      const updated = await ctx.repos.remediations.update(created.id, {
        status: 'completed',
        boost,
        outcome,
        resolvedAt,
      })
      expect(updated.version).toBe(created.version + 1)
      expect(updated.status).toBe('completed')
      expect(updated.boost).toEqual(boost)
      expect(updated.outcome).toEqual(outcome)
      expect(updated.resolvedAt?.getTime()).toBe(resolvedAt.getTime())

      const reread = await ctx.repos.remediations.findById(created.id)
      expect(reread?.status).toBe('completed')
      expect(reread?.boost).toEqual(boost)
      expect(reread?.outcome).toEqual(outcome)
      expect(reread?.resolvedAt?.getTime()).toBe(resolvedAt.getTime())
    })
  })
}
