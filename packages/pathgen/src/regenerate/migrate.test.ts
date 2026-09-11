import { describe, expect, it, vi } from 'vitest'
import {
  applyProgressMigration,
  conceptOfItem,
  MIGRATED_TAG,
  type MigrationItem,
  type MigrationLesson,
  ORPHAN_TAG,
  planProgressMigration,
} from './migrate'

function lesson(overrides: Partial<MigrationLesson>): MigrationLesson {
  return { id: 'l', kind: 'core', conceptIds: [], completed: false, ...overrides }
}

function item(overrides: Partial<MigrationItem>): MigrationItem {
  return { id: 'i', lessonId: null, topicId: null, fields: {}, tags: [], ...overrides }
}

describe('planProgressMigration()', () => {
  it('completes a v2 core lesson whose concepts were all taught by completed v1 core lessons, even merged from two', () => {
    const previous = [
      lesson({ id: 'v1a', conceptIds: ['c1'], completed: true }),
      lesson({ id: 'v1b', conceptIds: ['c2'], completed: true }),
    ]
    const next = [lesson({ id: 'v2x', conceptIds: ['c1', 'c2'], completed: false })]

    const plan = planProgressMigration({ previous, next, items: [] })

    expect(plan.complete).toEqual(['v2x'])
  })

  it('does not complete a v2 lesson with a concept only taught by a non-completed v1 lesson', () => {
    const previous = [
      lesson({ id: 'v1a', conceptIds: ['c1'], completed: true }),
      lesson({ id: 'v1b', conceptIds: ['c2'], completed: false }),
    ]
    const next = [lesson({ id: 'v2x', conceptIds: ['c1', 'c2'], completed: false })]

    const plan = planProgressMigration({ previous, next, items: [] })

    expect(plan.complete).toEqual([])
  })

  it('does not complete a v2 lesson that gained a brand-new concept', () => {
    const previous = [lesson({ id: 'v1a', conceptIds: ['c1'], completed: true })]
    const next = [lesson({ id: 'v2x', conceptIds: ['c1', 'c_new'], completed: false })]

    const plan = planProgressMigration({ previous, next, items: [] })

    expect(plan.complete).toEqual([])
  })

  it('never completes a lesson with zero concepts', () => {
    const previous = [lesson({ id: 'v1a', conceptIds: [], completed: true })]
    const next = [lesson({ id: 'v2x', conceptIds: [], completed: false })]

    const plan = planProgressMigration({ previous, next, items: [] })

    expect(plan.complete).toEqual([])
  })

  it('matches kinds: a reinforcement node only completes from completed v1 reinforcement concepts', () => {
    const previous = [
      lesson({ id: 'v1core', kind: 'core', conceptIds: ['c1'], completed: true }),
      lesson({ id: 'v1reinf', kind: 'reinforcement', conceptIds: ['c1'], completed: false }),
    ]
    const next = [
      lesson({ id: 'v2reinf', kind: 'reinforcement', conceptIds: ['c1'], completed: false }),
    ]

    // The concept was learned by a completed *core* lesson, but the v2 node is a reinforcement
    // node: it can only inherit completion from a completed v1 reinforcement node.
    const notCompleted = planProgressMigration({ previous, next, items: [] })
    expect(notCompleted.complete).toEqual([])

    const previousWithCompletedReinf = [
      lesson({ id: 'v1core', kind: 'core', conceptIds: ['c1'], completed: true }),
      lesson({ id: 'v1reinf', kind: 'reinforcement', conceptIds: ['c1'], completed: true }),
    ]
    const completed = planProgressMigration({
      previous: previousWithCompletedReinf,
      next,
      items: [],
    })
    expect(completed.complete).toEqual(['v2reinf'])
  })

  it('re-points an item to the first v2 lesson (in order) that teaches its topic concept', () => {
    const next = [
      lesson({ id: 'first', kind: 'core', conceptIds: ['c1'] }),
      lesson({ id: 'second', kind: 'core', conceptIds: ['c1'] }),
    ]
    const items = [item({ id: 'i1', topicId: 'c1' })]

    const plan = planProgressMigration({ previous: [], next, items })

    expect(plan.repoint).toEqual([{ itemId: 'i1', lessonId: 'first' }])
    expect(plan.orphans).toEqual([])
  })

  it('falls back to fields.concept_ids[0] when topicId is null', () => {
    expect(conceptOfItem({ topicId: null, fields: { concept_ids: ['c7', 'c8'] } })).toBe('c7')
    expect(conceptOfItem({ topicId: 'c1', fields: { concept_ids: ['c7'] } })).toBe('c1')
    expect(conceptOfItem({ topicId: null, fields: {} })).toBeNull()
    expect(conceptOfItem({ topicId: null, fields: { concept_ids: [] } })).toBeNull()
    expect(conceptOfItem({ topicId: null, fields: { concept_ids: [42] } })).toBeNull()

    const next = [lesson({ id: 'l1', kind: 'core', conceptIds: ['c7'] })]
    const items = [item({ id: 'i1', topicId: null, fields: { concept_ids: ['c7'] } })]
    const plan = planProgressMigration({ previous: [], next, items })
    expect(plan.repoint).toEqual([{ itemId: 'i1', lessonId: 'l1' }])
  })

  it('orphans an item whose concept no v2 lesson teaches', () => {
    const next = [lesson({ id: 'l1', kind: 'core', conceptIds: ['c1'] })]
    const items = [item({ id: 'i1', topicId: 'c_gone' })]

    const plan = planProgressMigration({ previous: [], next, items })

    expect(plan.orphans).toEqual(['i1'])
    expect(plan.repoint).toEqual([])
  })
})

describe('applyProgressMigration()', () => {
  const now = new Date('2026-09-11T00:00:00.000Z')

  function repos(knowledgeItems: boolean) {
    return {
      paths: { updateLesson: vi.fn().mockResolvedValue(undefined) },
      knowledgeItems: knowledgeItems ? { update: vi.fn().mockResolvedValue(undefined) } : undefined,
    }
  }

  it('marks completed lessons and re-points items, tagging them migrated and dropping the orphan tag', async () => {
    const items = [item({ id: 'i1', tags: [ORPHAN_TAG] })]
    const plan = {
      complete: ['lessonA'],
      repoint: [{ itemId: 'i1', lessonId: 'lessonB' }],
      orphans: [],
    }
    const deps = repos(true)

    const summary = await applyProgressMigration(deps, plan, items, now)

    expect(deps.paths.updateLesson).toHaveBeenCalledWith('lessonA', { completedAt: now })
    expect(deps.knowledgeItems?.update).toHaveBeenCalledWith('i1', {
      lessonId: 'lessonB',
      tags: [MIGRATED_TAG],
    })
    expect(summary).toEqual({ completed: 1, repointed: 1, orphaned: 0 })
  })

  it('does not duplicate the migrated tag on an item already tagged migrated', async () => {
    const items = [item({ id: 'i1', tags: [MIGRATED_TAG] })]
    const plan = { complete: [], repoint: [{ itemId: 'i1', lessonId: 'lessonB' }], orphans: [] }
    const deps = repos(true)

    await applyProgressMigration(deps, plan, items, now)

    expect(deps.knowledgeItems?.update).toHaveBeenCalledWith('i1', {
      lessonId: 'lessonB',
      tags: [MIGRATED_TAG],
    })
  })

  it('tags orphans "sin lección", keeps lessonId untouched, and does not duplicate the tag', async () => {
    const items = [item({ id: 'i1', lessonId: 'old-lesson', tags: [] })]
    const plan = { complete: [], repoint: [], orphans: ['i1'] }
    const deps = repos(true)

    const summary = await applyProgressMigration(deps, plan, items, now)

    expect(deps.knowledgeItems?.update).toHaveBeenCalledWith('i1', { tags: [ORPHAN_TAG] })
    expect(deps.knowledgeItems?.update).not.toHaveBeenCalledWith(
      'i1',
      expect.objectContaining({ lessonId: expect.anything() }),
    )
    expect(summary).toEqual({ completed: 0, repointed: 0, orphaned: 1 })

    const already = repos(true)
    await applyProgressMigration(
      already,
      { complete: [], repoint: [], orphans: ['i1'] },
      [item({ id: 'i1', lessonId: 'old-lesson', tags: [ORPHAN_TAG] })],
      now,
    )
    expect(already.knowledgeItems?.update).toHaveBeenCalledWith('i1', { tags: [ORPHAN_TAG] })
  })

  it('without a knowledgeItems repo, only applies completion — repointed and orphaned stay 0', async () => {
    const items = [item({ id: 'i1' })]
    const plan = {
      complete: ['lessonA'],
      repoint: [{ itemId: 'i1', lessonId: 'lessonB' }],
      orphans: ['i2'],
    }
    const deps = repos(false)

    const summary = await applyProgressMigration(deps, plan, items, now)

    expect(deps.paths.updateLesson).toHaveBeenCalledWith('lessonA', { completedAt: now })
    expect(summary).toEqual({ completed: 1, repointed: 0, orphaned: 0 })
  })
})
