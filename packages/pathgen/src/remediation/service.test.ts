import type { AiClient, Timers } from '@retenia/ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { silentLogger } from '../logger'
import { testPrompts } from '../testing/extract-fixtures'
import {
  type FakeAiOptions,
  fakeRemediationAi,
  type RemediationWorld,
  remediationWorld,
} from '../testing/remediation-world'
import { REMEDIATION_POLICY } from './policy'
import {
  createRemediationService,
  type RemediationChange,
  type RemediationServiceDeps,
} from './service'

/**
 * `createRemediationService` end to end over in-memory fakes (`docs/spec/04-path-generation.md`
 * §11; acceptance: "a failed reinforcement inserts at most one Lxx.rN per module; the base
 * lesson order and ids of v1 are untouched").
 */

function buildDeps(
  world: RemediationWorld,
  overrides: Partial<RemediationServiceDeps> = {},
): RemediationServiceDeps {
  const timers: Pick<Timers, 'sleep'> = { sleep: async () => {} }
  return {
    ai: world.ai as Pick<AiClient, 'structured'>,
    author: world.author,
    prompts: { remediation: testPrompts.remediation },
    repos: world.repos,
    clock: world.clock,
    timers,
    logger: silentLogger,
    ...overrides,
  }
}

describe('createRemediationService', () => {
  let world: RemediationWorld

  beforeEach(() => {
    world = remediationWorld()
  })

  it('inserts exactly one detour per module reinforcement, refuses the rest, and leaves the base lessons untouched', async () => {
    const before = structuredClone(
      world.rows.lessons.map((lesson) => ({
        id: lesson.id,
        specId: lesson.specId,
        ordinal: lesson.ordinal,
        moduleId: lesson.moduleId,
      })),
    )
    const service = createRemediationService(buildDeps(world))

    const decisions = await service.handle({
      kind: 'reinforcement_completed',
      pathVersionId: world.pathVersionId,
      moduleId: world.moduleIds.M01,
      answers: [
        // c1: 0/2 — worst, processed first.
        { conceptIds: ['c1'], correct: false },
        { conceptIds: ['c1'], correct: false },
        // c2: 1/3.
        { conceptIds: ['c2'], correct: false },
        { conceptIds: ['c2'], correct: false },
        { conceptIds: ['c2'], correct: true },
        // c9: 2/3 — not taught anywhere; still anchors inside M01 by the fallback rule.
        { conceptIds: ['c9'], correct: false },
        { conceptIds: ['c9'], correct: true },
        { conceptIds: ['c9'], correct: true },
      ],
    })

    expect(decisions).toHaveLength(3)
    const [first, second, third] = decisions

    expect(first?.kind).toBe('inserted')
    if (first?.kind === 'inserted') {
      expect(first.remediation.specId).toBe('L01.r1')
      expect(first.remediation.status).toBe('active')
      expect(first.lesson.kind).toBe('remediation')
      expect(first.lesson.status).toBe('ready')
      expect(first.lesson.parentLessonId).toBe(world.lessonIds.L01)
      expect(first.lesson.ordinal).toBe(0)
      expect(first.remediation.conceptId).toBe('c1')
    }

    expect(second?.kind).toBe('refused')
    if (second?.kind === 'refused') expect(second.refusal).toBe('module_active')
    expect(third?.kind).toBe('refused')
    if (third?.kind === 'refused') expect(third.refusal).toBe('module_active')

    const after = world.rows.lessons
      .filter((lesson) => lesson.kind === 'core')
      .map((lesson) => ({
        id: lesson.id,
        specId: lesson.specId,
        ordinal: lesson.ordinal,
        moduleId: lesson.moduleId,
      }))
    expect(after).toEqual(before)
  })

  it('writes the P11 content: theory blocks, bank+generated activities, one contrast item with a card, and bumps bank exposure', async () => {
    world.rows.itemBank.push({
      id: 'bank-1',
      activityId: 'activity-bank-1',
      pathVersionId: world.pathVersionId,
      moduleId: world.moduleIds.M01,
      usage: ['reinforcement', 'remediation'],
      difficultyLogit: 0,
      discriminationHint: null,
      exposure: 0,
      stats: {},
      authoring: { cell_key: 'cell-1', stem: 'stem', concept_ids: ['c1'] },
      createdAt: world.clock.now(),
      updatedAt: world.clock.now(),
      deletedAt: null,
      deviceId: 'test',
      version: 1,
    })
    world.rows.activities.push({
      id: 'activity-bank-1',
      lessonId: null,
      ordinal: null,
      type: 'mcq_single',
      family: 'choice',
      schemaVersion: 1,
      lang: 'es-AR',
      bloom: 'understand',
      difficulty: 2,
      conceptIds: ['c1'],
      misconceptionIds: [],
      config: { prompt: 'del banco' },
      grading: { method: 'det' },
      status: 'ready',
      sourceRefs: [],
      createdAt: world.clock.now(),
      updatedAt: world.clock.now(),
      deletedAt: null,
      deviceId: 'test',
      version: 1,
    })

    const service = createRemediationService(buildDeps(world))
    const decisions = await service.handle({
      kind: 'not_understood',
      lessonId: world.lessonIds.L01,
      conceptId: 'c1',
    })
    const decision = decisions[0]
    expect(decision?.kind).toBe('inserted')
    if (decision?.kind !== 'inserted') throw new Error('expected an insert')

    const theory = decision.lesson.theory as { blocks: { type: string; content: string }[] } | null
    expect(theory).not.toBeNull()
    expect(theory?.blocks.length).toBeGreaterThan(0)
    expect(theory?.blocks.some((block) => block.type === 'explanation')).toBe(true)

    const activities = world.rows.activities.filter((row) => row.lessonId === decision.lesson.id)
    // one reused bank item + two generated items (policy.items = 3, one already reused).
    expect(activities).toHaveLength(3)
    expect(activities.map((activity) => activity.ordinal).toSorted()).toEqual([0, 1, 2])
    expect(world.rows.itemBank.find((row) => row.id === 'bank-1')?.exposure).toBe(1)

    const contrastItems = world.rows.knowledgeItems.filter(
      (item) => item.lessonId === decision.lesson.id,
    )
    expect(contrastItems).toHaveLength(1)
    expect(contrastItems[0]?.tags).toEqual(['remediation'])
    expect(contrastItems[0]?.status).toBe('need_to_learn')
    const contrastCard = world.rows.cards.find((card) => card.itemId === contrastItems[0]?.id)
    expect(contrastCard).toBeDefined()
  })

  it('raises the concept’s cards to high for 14 days, leaves a manually overridden card alone, and logs the boosted ids', async () => {
    const [card1, card2] = world.cardsOf('c1')
    if (card1 === undefined || card2 === undefined) throw new Error('expected two cards')
    // Someone already set a manual (permanent) override on card2: the raise must not touch it.
    world.rows.cards[world.rows.cards.findIndex((row) => row.id === card2.id)] = {
      ...card2,
      importanceOverride: 'normal',
      importanceOverrideExpiresAt: null,
    }

    const service = createRemediationService(buildDeps(world))
    const decisions = await service.handle({
      kind: 'not_understood',
      lessonId: world.lessonIds.L01,
      conceptId: 'c1',
    })
    const decision = decisions[0]
    if (decision?.kind !== 'inserted') throw new Error('expected an insert')

    const rowCard1 = world.rows.cards.find((row) => row.id === card1.id)
    expect(rowCard1?.importanceOverride).toBe('high')
    expect(rowCard1?.importanceOverrideExpiresAt?.getTime()).toBe(
      world.clock.now().getTime() + REMEDIATION_POLICY.boostDays * 86_400_000,
    )

    const rowCard2 = world.rows.cards.find((row) => row.id === card2.id)
    expect(rowCard2?.importanceOverride).toBe('normal')
    expect(rowCard2?.importanceOverrideExpiresAt).toBeNull()

    const boost = decision.remediation.boost as { card_ids: string[] }
    expect(boost.card_ids).toEqual([card1.id])
  })

  it('refuses a 4th remediation in the same week with weekly_limit, once 3 were already inserted', async () => {
    const recent = new Date(world.clock.now().getTime() - 86_400_000)
    for (const [conceptId, moduleId] of [
      ['c1', world.moduleIds.M01],
      ['c2', world.moduleIds.M01],
      ['c3', world.moduleIds.M02],
    ] as const) {
      await world.repos.remediations.create({
        pathVersionId: world.pathVersionId,
        moduleId,
        conceptId,
        misconceptionId: null,
        trigger: 'user_request',
        status: 'completed',
        refusal: null,
        anchorLessonId: null,
        lessonId: null,
        specId: null,
        evidence: {},
        boost: {},
        outcome: null,
        resolvedAt: recent,
      })
      // Backdate `createdAt` too — `create` stamps it from the clock's current instant.
      const row = world.rows.remediations.at(-1)
      if (row !== undefined) row.createdAt = recent
    }

    const service = createRemediationService(buildDeps(world))
    const decisions = await service.handle({
      kind: 'not_understood',
      lessonId: world.lessonIds.L04,
      conceptId: 'c4',
    })
    expect(decisions).toHaveLength(1)
    expect(decisions[0]?.kind).toBe('refused')
    if (decisions[0]?.kind === 'refused') expect(decisions[0].refusal).toBe('weekly_limit')
  })

  it('dismiss soft-deletes the lesson and never reuses its spec id; a new detour on the same anchor gets .r2', async () => {
    const service = createRemediationService(buildDeps(world))
    const first = (
      await service.handle({
        kind: 'not_understood',
        lessonId: world.lessonIds.L01,
        conceptId: 'c1',
      })
    )[0]
    if (first?.kind !== 'inserted') throw new Error('expected an insert')
    expect(first.remediation.specId).toBe('L01.r1')

    const dismissed = await service.dismiss(first.remediation.id)
    expect(dismissed.status).toBe('dismissed')
    const lessonRow = world.rows.lessons.find((row) => row.id === first.lesson.id)
    expect(lessonRow?.deletedAt).not.toBeNull()

    const tree = await world.repos.paths.loadTree(world.pathVersionId)
    const lessonIds =
      tree?.sections.flatMap((s) => s.modules.flatMap((m) => m.lessons.map((l) => l.id))) ?? []
    expect(lessonIds).not.toContain(first.lesson.id)

    const second = (
      await service.handle({
        kind: 'not_understood',
        lessonId: world.lessonIds.L01,
        conceptId: 'c1',
      })
    )[0]
    expect(second?.kind).toBe('inserted')
    if (second?.kind === 'inserted') expect(second.remediation.specId).toBe('L01.r2')
  })

  it('complete sets the lesson’s completedAt, promotes the contrast item, and records the outcome', async () => {
    const service = createRemediationService(buildDeps(world))
    const inserted = (
      await service.handle({
        kind: 'not_understood',
        lessonId: world.lessonIds.L01,
        conceptId: 'c1',
      })
    )[0]
    if (inserted?.kind !== 'inserted') throw new Error('expected an insert')

    const completed = await service.complete(inserted.remediation.id)
    expect(completed.status).toBe('completed')
    expect(completed.outcome).not.toBeNull()

    const lessonRow = world.rows.lessons.find((row) => row.id === inserted.lesson.id)
    expect(lessonRow?.completedAt).not.toBeNull()

    const contrastItem = world.rows.knowledgeItems.find(
      (item) => item.lessonId === inserted.lesson.id,
    )
    expect(contrastItem?.status).toBe('active')
  })

  it('a P11 failure marks the decision and the remediation failed, soft-deletes the lesson, and counts toward the weekly limit', async () => {
    const failingAi = fakeRemediationAi({
      failSpecIds: new Set(['L01.r1']),
    } satisfies FakeAiOptions)
    const service = createRemediationService(buildDeps(world, { ai: failingAi as never }))

    const failed = (
      await service.handle({
        kind: 'not_understood',
        lessonId: world.lessonIds.L01,
        conceptId: 'c1',
      })
    )[0]
    expect(failed?.kind).toBe('failed')
    if (failed?.kind === 'failed') {
      expect(failed.remediation.status).toBe('failed')
      const lessonRow = world.rows.lessons.find((row) => row.id === failed.remediation.lessonId)
      expect(lessonRow?.deletedAt).not.toBeNull()
    }

    // The failed attempt was a paid P11 call, so it takes one of the week's 3 slots: two more
    // detours fit, the third is refused weekly_limit. Each is completed before the next so a
    // module's "1 active" cap never gets in the way.
    const c1Retry = (
      await service.handle({
        kind: 'not_understood',
        lessonId: world.lessonIds.L01,
        conceptId: 'c1',
      })
    )[0]
    expect(c1Retry?.kind).toBe('inserted')
    if (c1Retry?.kind === 'inserted') await service.complete(c1Retry.remediation.id)

    const c2 = (
      await service.handle({
        kind: 'not_understood',
        lessonId: world.lessonIds.L02,
        conceptId: 'c2',
      })
    )[0]
    expect(c2?.kind).toBe('inserted')
    if (c2?.kind === 'inserted') await service.complete(c2.remediation.id)

    const c3 = (
      await service.handle({
        kind: 'not_understood',
        lessonId: world.lessonIds.L03,
        conceptId: 'c3',
      })
    )[0]
    expect(c3?.kind).toBe('refused')
    if (c3?.kind === 'refused') expect(c3.refusal).toBe('weekly_limit')
  })

  it('two clean reviews release a boosted card, an Again in between resets the streak, and a card whose override changed elsewhere is left alone', async () => {
    const service = createRemediationService(buildDeps(world))
    const inserted = (
      await service.handle({
        kind: 'not_understood',
        lessonId: world.lessonIds.L01,
        conceptId: 'c1',
      })
    )[0]
    if (inserted?.kind !== 'inserted') throw new Error('expected an insert')
    const [card1, card2] = world.cardsOf('c1')
    if (card1 === undefined || card2 === undefined) throw new Error('expected two cards')
    expect(world.rows.cards.find((row) => row.id === card1.id)?.importanceOverride).toBe('high')

    // card1: clean, Again (resets), clean, clean → released only on the 4th call.
    await service.handle({
      kind: 'card_reviewed',
      cardId: card1.id,
      rating: 3,
      at: world.clock.now(),
    })
    expect(world.rows.cards.find((row) => row.id === card1.id)?.importanceOverride).toBe('high')
    await service.handle({
      kind: 'card_reviewed',
      cardId: card1.id,
      rating: 1,
      at: world.clock.now(),
    })
    expect(world.rows.cards.find((row) => row.id === card1.id)?.importanceOverride).toBe('high')
    await service.handle({
      kind: 'card_reviewed',
      cardId: card1.id,
      rating: 3,
      at: world.clock.now(),
    })
    expect(world.rows.cards.find((row) => row.id === card1.id)?.importanceOverride).toBe('high')
    await service.handle({
      kind: 'card_reviewed',
      cardId: card1.id,
      rating: 3,
      at: world.clock.now(),
    })
    expect(world.rows.cards.find((row) => row.id === card1.id)?.importanceOverride).toBeNull()

    // card2: someone else's override lands on it after the boost; two clean reviews must not touch it.
    const index = world.rows.cards.findIndex((row) => row.id === card2.id)
    world.rows.cards[index] = {
      ...(world.rows.cards[index] as (typeof world.rows.cards)[number]),
      importanceOverride: 'urgent',
      importanceOverrideExpiresAt: null,
    }
    await service.handle({
      kind: 'card_reviewed',
      cardId: card2.id,
      rating: 3,
      at: world.clock.now(),
    })
    await service.handle({
      kind: 'card_reviewed',
      cardId: card2.id,
      rating: 3,
      at: world.clock.now(),
    })
    const rowCard2 = world.rows.cards.find((row) => row.id === card2.id)
    expect(rowCard2?.importanceOverride).toBe('urgent')
    expect(rowCard2?.importanceOverrideExpiresAt).toBeNull()
  })

  it('two memory lapses in 14 days on a concept’s cards insert a memory_lapses remediation', async () => {
    const [card] = world.cardsOf('c3')
    if (card === undefined) throw new Error('expected a card')
    const now = world.clock.now()
    world.rows.reviewLogs.push(
      {
        id: 'log-1',
        cardId: card.id,
        rating: 1,
        state: 2,
        due: now,
        stability: 1,
        difficulty: 1,
        elapsedDays: 1,
        scheduledDays: 1,
        learningSteps: 0,
        review: new Date(now.getTime() - 2 * 86_400_000),
        durationMs: null,
        context: 'daily',
        exerciseScore: null,
        device: null,
        attemptId: null,
        activityType: null,
        algorithmVersion: 'fsrs6',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deviceId: 'test',
        version: 1,
      },
      {
        id: 'log-2',
        cardId: card.id,
        rating: 1,
        state: 2,
        due: now,
        stability: 1,
        difficulty: 1,
        elapsedDays: 1,
        scheduledDays: 1,
        learningSteps: 0,
        review: new Date(now.getTime() - 5 * 86_400_000),
        durationMs: null,
        context: 'daily',
        exerciseScore: null,
        device: null,
        attemptId: null,
        activityType: null,
        algorithmVersion: 'fsrs6',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deviceId: 'test',
        version: 1,
      },
    )

    const service = createRemediationService(buildDeps(world))
    const decisions = await service.handle({
      kind: 'card_reviewed',
      cardId: card.id,
      rating: 3,
      at: now,
    })
    expect(decisions).toHaveLength(1)
    expect(decisions[0]?.kind).toBe('inserted')
    if (decisions[0]?.kind === 'inserted') {
      expect(decisions[0].remediation.trigger).toBe('memory_lapses')
      expect(decisions[0].remediation.conceptId).toBe('c3')
    }
  })

  it('not_understood falls back to the lesson’s own concept when the given one is not in it, and anchors after that lesson', async () => {
    const service = createRemediationService(buildDeps(world))
    const decisions = await service.handle({
      kind: 'not_understood',
      lessonId: world.lessonIds.L02,
      conceptId: 'not-a-concept-of-this-lesson',
    })
    expect(decisions).toHaveLength(1)
    const decision = decisions[0]
    expect(decision?.kind).toBe('inserted')
    if (decision?.kind === 'inserted') {
      expect(decision.remediation.conceptId).toBe('c2')
      expect(decision.remediation.specId).toBe('L02.r1')
      expect(decision.lesson.parentLessonId).toBe(world.lessonIds.L02)
      expect(decision.lesson.ordinal).toBe(1)
    }
  })

  it('ignores a signal whose version is not the path’s active one, or not frozen', async () => {
    const inactive = remediationWorld()
    inactive.rows.paths[0] = {
      ...(inactive.rows.paths[0] as (typeof inactive.rows.paths)[number]),
      activeVersion: 2,
    }
    const inactiveService = createRemediationService(buildDeps(inactive))
    const inactiveDecisions = await inactiveService.handle({
      kind: 'reinforcement_completed',
      pathVersionId: inactive.pathVersionId,
      moduleId: inactive.moduleIds.M01,
      answers: [{ conceptIds: ['c1'], correct: false }],
    })
    expect(inactiveDecisions).toHaveLength(1)
    expect(inactiveDecisions[0]).toEqual({ kind: 'ignored', reason: 'version_not_active' })

    const unfrozen = remediationWorld()
    unfrozen.rows.versions[0] = {
      ...(unfrozen.rows.versions[0] as (typeof unfrozen.rows.versions)[number]),
      frozenAt: null,
    }
    const unfrozenService = createRemediationService(buildDeps(unfrozen))
    const unfrozenDecisions = await unfrozenService.handle({
      kind: 'reinforcement_completed',
      pathVersionId: unfrozen.pathVersionId,
      moduleId: unfrozen.moduleIds.M01,
      answers: [{ conceptIds: ['c1'], correct: false }],
    })
    expect(unfrozenDecisions).toHaveLength(1)
    expect(unfrozenDecisions[0]).toEqual({ kind: 'ignored', reason: 'version_not_active' })
  })

  it('the third remediation of one concept is refused revisit_core, names the teaching lesson, and calls onRevisitCore', async () => {
    for (const specId of ['L01.r1', 'L01.r2']) {
      await world.repos.remediations.create({
        pathVersionId: world.pathVersionId,
        moduleId: world.moduleIds.M01,
        conceptId: 'c1',
        misconceptionId: null,
        trigger: 'user_request',
        status: 'completed',
        refusal: null,
        anchorLessonId: world.lessonIds.L01,
        lessonId: null,
        specId,
        evidence: {},
        boost: {},
        outcome: null,
        resolvedAt: world.clock.now(),
      })
    }

    const onRevisitCore = vi.fn(async () => {})
    const service = createRemediationService(buildDeps(world, { onRevisitCore }))
    const decisions = await service.handle({
      kind: 'not_understood',
      lessonId: world.lessonIds.L01,
      conceptId: 'c1',
    })
    expect(decisions).toHaveLength(1)
    const decision = decisions[0]
    expect(decision?.kind).toBe('refused')
    if (decision?.kind === 'refused') {
      expect(decision.refusal).toBe('revisit_core')
      expect(decision.revisitLessonId).toBe(world.lessonIds.L01)
      expect(decision.remediation?.evidence.revisit_lesson_id).toBe(world.lessonIds.L01)
    }
    expect(onRevisitCore).toHaveBeenCalledTimes(1)
    expect(onRevisitCore).toHaveBeenCalledWith({
      pathVersionId: world.pathVersionId,
      moduleId: world.moduleIds.M01,
      conceptId: 'c1',
      lessonId: world.lessonIds.L01,
    })
  })

  it('onChange fires inserted then updated for a successful insert, refused for a logged refusal, and removed on dismiss', async () => {
    const changes: RemediationChange[] = []
    const service = createRemediationService(
      buildDeps(world, { onChange: (change) => changes.push(change) }),
    )

    const inserted = (
      await service.handle({
        kind: 'not_understood',
        lessonId: world.lessonIds.L01,
        conceptId: 'c1',
      })
    )[0]
    if (inserted?.kind !== 'inserted') throw new Error('expected an insert')
    expect(changes.map((change) => change.kind)).toEqual(['inserted', 'updated'])

    changes.length = 0
    // c1's module (M01) already has an active detour: a fresh concept in the same module is
    // refused (and logged — unlike a duplicate trigger on the same concept, which is not).
    const refused = (
      await service.handle({
        kind: 'not_understood',
        lessonId: world.lessonIds.L02,
        conceptId: 'c2',
      })
    )[0]
    expect(refused?.kind).toBe('refused')
    if (refused?.kind === 'refused') expect(refused.refusal).toBe('module_active')
    expect(changes.map((change) => change.kind)).toEqual(['refused'])

    changes.length = 0
    await service.dismiss(inserted.remediation.id)
    expect(changes.map((change) => change.kind)).toEqual(['removed'])
  })
})
