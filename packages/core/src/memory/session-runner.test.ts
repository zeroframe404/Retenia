import { beforeEach, describe, expect, it } from 'vitest'
import type { Card, ImportanceLevel, KnowledgeItem } from '../entities'
import type { DomainEventPublisher } from '../ports/domain-events'
import { SETTINGS_DEFAULTS, type SettingsKey, type SettingsMap } from '../ports/settings-repository'
import { type FakeClock, fakeClock } from '../testing/in-memory-job-repository'
import {
  createInMemoryReviewStore,
  type InMemoryReviewStore,
} from '../testing/in-memory-review-store'
import { createFsrsScheduler, type FsrsScheduler } from './fsrs-scheduler'
import { DEFAULT_IMPORTANCE_CATALOG } from './importance'
import { createReviewCard } from './review-card'
import { createImportanceSchedulingPolicy } from './scheduling-policy'
import type { SessionCardEntry } from './session'
import { createComposeSession } from './session-service'
import { createStartSession, type StartSession, type StartSessionResult } from './session-start'
import { DAY_MS } from './study-day'
import { CARD_STATE, RATING } from './types'

/**
 * The session runtime end to end: start (which applies the plan), answer, skip, undo,
 * resume and finish (`docs/spec/02-memory-system.md` §12).
 *
 * The in-memory unit of work is the same double `reviewCard` is tested against, so what is
 * exercised here is the composer, the runner and the write path together — including the
 * one thing undo is allowed to do to a review.
 */

const NOW = new Date('2026-06-01T12:00:00Z')
const DAY_BOUNDARY = { dayStartHour: 0 }

let clock: FakeClock
let store: InMemoryReviewStore
let scheduler: FsrsScheduler
let start: StartSession
let published: string[]
let sequence: number

const settings = {
  get: <K extends SettingsKey>(key: K): Promise<SettingsMap[K]> =>
    Promise.resolve(SETTINGS_DEFAULTS[key]),
}

function id(prefix: string): string {
  sequence += 1
  return `019a0000-0000-7000-8000-${prefix}${String(sequence).padStart(8, '0')}`
}

async function seedItem(importance: ImportanceLevel = 'normal'): Promise<KnowledgeItem> {
  return store.knowledgeItems.create({
    id: id('aaaa'),
    lessonId: null,
    topicId: null,
    kind: 'fact',
    fields: { front: 'q', back: 'a' },
    sourceId: null,
    annotationId: null,
    locator: null,
    asOf: null,
    importance,
    status: 'active',
    createdBy: 'user',
    tags: [],
  })
}

interface SeedSpec {
  item?: KnowledgeItem
  importance?: ImportanceLevel
  state?: Card['state']
  stability?: number
  scheduledDays?: number
  elapsedDays?: number
}

async function seedCard(spec: SeedSpec = {}): Promise<Card> {
  const item = spec.item ?? (await seedItem(spec.importance ?? 'normal'))
  const state = spec.state ?? CARD_STATE.Review
  const elapsedDays = spec.elapsedDays ?? 12
  const scheduledDays = spec.scheduledDays ?? 10
  return store.cards.create({
    id: id('cccc'),
    itemId: item.id,
    template: 'basic',
    payload: null,
    due: new Date(NOW.getTime() - (elapsedDays - scheduledDays) * DAY_MS),
    stability: spec.stability ?? 20,
    difficulty: 5,
    scheduledDays,
    learningSteps: 0,
    reps: 4,
    lapses: 0,
    state,
    lastReview: state === CARD_STATE.New ? null : new Date(NOW.getTime() - elapsedDays * DAY_MS),
    suspended: false,
    buriedUntil: null,
    leech: false,
    importanceOverride: null,
    importanceOverrideExpiresAt: null,
    examId: null,
  })
}

function build(overrides: { finalDrill?: boolean; budgetMinutes?: number } = {}): StartSession {
  const events: DomainEventPublisher = {
    publish: (event) => {
      published.push(event.type)
    },
  }
  const repos = { ...store, settings }
  const reviewCard = createReviewCard({
    uow: store,
    scheduler,
    policy: createImportanceSchedulingPolicy({ catalog: DEFAULT_IMPORTANCE_CATALOG }),
    events,
    clock,
  })
  const compose = createComposeSession({
    repos,
    scheduler,
    catalog: DEFAULT_IMPORTANCE_CATALOG,
    clock,
    dayBoundary: DAY_BOUNDARY,
  })
  return createStartSession({
    uow: store,
    compose: (settingsOverrides = {}, at) => compose({ ...overrides, ...settingsOverrides }, at),
    reviewCard,
    scheduler,
    catalog: DEFAULT_IMPORTANCE_CATALOG,
    clock,
    dayBoundary: DAY_BOUNDARY,
  })
}

const started = (): Promise<StartSessionResult> => start({ confirm: true })

const cardIdsOf = (result: StartSessionResult): string[] =>
  result.entries
    .filter((entry): entry is SessionCardEntry => entry.kind !== 'reinforcement')
    .map((entry) => entry.card.id)

beforeEach(() => {
  sequence = 0
  published = []
  clock = fakeClock(NOW.getTime())
  store = createInMemoryReviewStore(clock)
  scheduler = createFsrsScheduler({ dayStartHour: 0 })
  start = build()
})

describe('starting a session', () => {
  it('refuses to apply a plan without an explicit confirmation', async () => {
    await expect(start({ confirm: false as unknown as true })).rejects.toThrow(/confirmation/)
  })

  it('freezes the queue order into the session row, as ids rather than cards', async () => {
    await seedCard()
    await seedCard()
    const result = await started()

    const stored = store.reviewSessions.all()[0]
    expect(stored?.status).toBe('in_progress')
    const snapshot = stored?.plan as unknown as { entries: { cardId: string | null }[] }
    expect(snapshot.entries.map((entry) => entry.cardId)).toEqual(cardIdsOf(result))
    // The cards themselves are not duplicated into the row.
    expect(JSON.stringify(stored?.plan)).not.toContain('"stability"')
  })
})

describe('answering', () => {
  it('writes one card update and one review log per answer', async () => {
    const card = await seedCard()
    const result = await started()
    const runner = result.runner

    expect(runner.next()).not.toBeNull()
    const answered = await runner.answer(RATING.Good)

    expect(answered.card.id).toBe(card.id)
    expect(answered.card.reps).toBe(5)
    expect(store.reviewLogs.all()).toHaveLength(1)
    expect(store.reviewLogs.all()[0]?.context).toBe('daily')
    expect(published).toEqual(['card.reviewed'])
    expect(runner.state().reviewed).toBe(1)
  })

  it('accepts a bare grade and a grader result alike', async () => {
    await seedCard()
    await seedCard()
    const { runner } = await started()

    runner.next()
    await runner.answer(RATING.Good)
    runner.next()
    await runner.answer({ rating: RATING.Hard, exerciseScore: 0.7, durationMs: 4_200 })

    const logs = store.reviewLogs.all()
    expect(logs[1]?.exerciseScore).toBe(0.7)
    expect(logs[1]?.durationMs).toBe(4_200)
  })

  it('times the card from next() when the host does not measure it', async () => {
    await seedCard()
    const { runner } = await started()
    runner.next()
    clock.advance(3_500)
    await runner.answer(RATING.Good)
    expect(store.reviewLogs.all()[0]?.durationMs).toBe(3_500)
  })

  it('rejects a rating outside 1–4 — Manual is never an answer', async () => {
    await seedCard()
    const { runner } = await started()
    runner.next()
    await expect(runner.answer(0 as unknown as 1)).rejects.toThrow(/rating must be 1/)
  })

  it('skip advances without writing anything', async () => {
    await seedCard()
    await seedCard()
    const { runner } = await started()

    runner.next()
    await runner.skip()
    expect(store.reviewLogs.all()).toHaveLength(0)
    expect(runner.state().skipped).toBe(1)
    expect(runner.state().cursor).toBe(1)

    runner.next()
    await runner.answer(RATING.Good)
    expect(runner.next()).toBeNull()
  })
})

describe('§12 step 6 — the final drill', () => {
  it('brings everything graded Again or Hard back at the end', async () => {
    start = build({ finalDrill: true })
    const first = await seedCard()
    const second = await seedCard()
    const third = await seedCard()
    const { runner } = await started()

    const order: string[] = []
    for (const rating of [RATING.Again, RATING.Good, RATING.Hard]) {
      const entry = runner.next() as SessionCardEntry
      order.push(entry.card.id)
      await runner.answer(rating)
    }
    expect(new Set(order)).toEqual(new Set([first.id, second.id, third.id]))

    // The two that were not `Good` come back, in the order they were failed.
    const drillFirst = runner.next() as SessionCardEntry
    expect(drillFirst.card.id).toBe(order[0])
    await runner.answer(RATING.Good)
    const drillSecond = runner.next() as SessionCardEntry
    expect(drillSecond.card.id).toBe(order[2])
    await runner.answer(RATING.Good)

    expect(runner.next()).toBeNull()
    expect(runner.state().reviewed).toBe(5)
  })

  it('is off unless asked for', async () => {
    await seedCard()
    const { runner } = await started()
    runner.next()
    await runner.answer(RATING.Again)
    expect(runner.next()).toBeNull()
    expect(runner.state().drillPending).toBe(0)
  })
})

describe('undo', () => {
  it('restores the card exactly and soft-deletes the log', async () => {
    const card = await seedCard()
    const { runner } = await started()
    const before = (await store.cards.findById(card.id)) as Card

    runner.next()
    const answered = await runner.answer(RATING.Good)
    expect(answered.card.stability).not.toBe(before.stability)

    const undone = await runner.undo()
    expect(undone?.cardId).toBe(card.id)

    const after = (await store.cards.findById(card.id)) as Card
    expect(after.stability).toBe(before.stability)
    expect(after.difficulty).toBe(before.difficulty)
    expect(after.reps).toBe(before.reps)
    expect(after.lapses).toBe(before.lapses)
    expect(after.state).toBe(before.state)
    expect(after.learningSteps).toBe(before.learningSteps)
    expect(after.scheduledDays).toBe(before.scheduledDays)
    expect(after.lastReview).toEqual(before.lastReview)
    // The one thing `rollback` cannot restore is the *previous* due date: `ts-fsrs` does not
    // record it and books the review instant instead (pinned by `fsrs-scheduler.test.ts`).
    // The card was overdue and is now due at `now`, so it comes straight back — which is
    // what undo is for.
    expect(after.due).toEqual(NOW)
    expect(after.due.getTime()).toBeGreaterThanOrEqual(before.due.getTime())

    // Append-only: the row is still there, marked deleted, with `updatedAt` and `version`
    // untouched (`.claude/skills/fsrs-rules/SKILL.md`).
    const log = store.reviewLogs.all()[0]
    expect(log?.deletedAt).not.toBeNull()
    expect(log?.version).toBe(1)
    expect(log?.updatedAt).toEqual(log?.createdAt)
    expect(await store.reviewLogs.listByCard(card.id)).toHaveLength(0)

    expect(runner.state().reviewed).toBe(0)
    expect(runner.state().cursor).toBe(0)
    expect((runner.next() as SessionCardEntry).card.id).toBe(card.id)
  })

  it('returns null when there is nothing to undo', async () => {
    await seedCard()
    const { runner } = await started()
    expect(await runner.undo()).toBeNull()
  })

  it('walks back over skips, which wrote nothing', async () => {
    await seedCard()
    await seedCard()
    const { runner } = await started()
    runner.next()
    await runner.answer(RATING.Good)
    runner.next()
    await runner.skip()

    expect(runner.state().cursor).toBe(2)
    await runner.undo()
    // Both the skip and the answer are rolled back: the skip alone is not an undoable step.
    expect(runner.state().cursor).toBe(0)
    expect(runner.state().reviewed).toBe(0)
    expect(runner.state().skipped).toBe(0)
  })

  it('takes the card back out of the final drill', async () => {
    start = build({ finalDrill: true })
    await seedCard()
    const { runner } = await started()
    runner.next()
    await runner.answer(RATING.Again)
    expect(runner.state().drillPending + (runner.next() === null ? 0 : 1)).toBeGreaterThan(0)

    await runner.undo()
    expect(runner.state().drillPending).toBe(0)
  })
})

describe('resuming after the app is closed', () => {
  it('picks the same queue up at the same place', async () => {
    await seedCard()
    await seedCard()
    await seedCard()

    const first = await started()
    const order = cardIdsOf(first)
    first.runner.next()
    await first.runner.answer(RATING.Good)
    first.runner.next()
    await first.runner.answer(RATING.Good)

    // The app closes: a brand-new start against the same database.
    start = build()
    const resumed = await started()

    expect(resumed.resumed).toBe(true)
    expect(resumed.session.id).toBe(first.session.id)
    expect(cardIdsOf(resumed)).toEqual(order)
    expect(resumed.runner.state().cursor).toBe(2)
    expect(resumed.runner.state().reviewed).toBe(2)
    expect((resumed.runner.next() as SessionCardEntry).card.id).toBe(order[2])

    await resumed.runner.answer(RATING.Good)
    expect(resumed.runner.next()).toBeNull()
    expect(store.reviewSessions.all()).toHaveLength(1)
  })

  it('does not postpone or bury a second time when it resumes', async () => {
    // 1 minute of budget at the 8 s fallback is 7 cards of capacity; 20 will not fit.
    for (let i = 0; i < 20; i++) await seedCard({ importance: 'maintenance' })
    start = build({ budgetMinutes: 1 })
    const first = await started()
    expect(first.postponed).toBeGreaterThan(0)
    const logsAfterStart = store.reviewLogs.all().length

    start = build({ budgetMinutes: 1 })
    const resumed = await started()
    expect(resumed.resumed).toBe(true)
    expect(store.reviewLogs.all()).toHaveLength(logsAfterStart)
  })

  it('abandons a session left open on an earlier day and composes a fresh one', async () => {
    await seedCard()
    const first = await started()

    clock.advance(2 * DAY_MS)
    start = build()
    const next = await started()

    expect(next.resumed).toBe(false)
    expect(next.session.id).not.toBe(first.session.id)
    const stale = await store.reviewSessions.findById(first.session.id)
    expect(stale?.status).toBe('abandoned')
  })

  it('drops a card that was suspended since the plan was frozen', async () => {
    const keep = await seedCard()
    const gone = await seedCard()
    const first = await started()
    expect(cardIdsOf(first)).toHaveLength(2)

    await store.cards.update(gone.id, { suspended: true })
    start = build()
    const resumed = await started()
    expect(cardIdsOf(resumed)).toEqual([keep.id])
  })
})

describe('overload protection at start', () => {
  it('moves the chosen cards and logs each as rating Manual / manual_postpone', async () => {
    for (let i = 0; i < 20; i++)
      await seedCard({ importance: 'maintenance', scheduledDays: 30, elapsedDays: 40 })
    start = build({ budgetMinutes: 1 })
    const result = await started()

    expect(result.postponed).toBeGreaterThan(0)
    const logs = store.reviewLogs.all()
    expect(logs).toHaveLength(result.postponed)
    expect(logs.every((log) => log.rating === RATING.Manual)).toBe(true)
    expect(logs.every((log) => log.context === 'manual_postpone')).toBe(true)

    // S and D are untouched: a postpone is not a review (§7 rule 3).
    for (const log of logs) {
      const card = (await store.cards.findById(log.cardId)) as Card
      expect(card.stability).toBe(20)
      expect(card.difficulty).toBe(5)
      expect(card.due.getTime()).toBeGreaterThan(NOW.getTime())
      expect(card.lastReview).toEqual(new Date(NOW.getTime() - 40 * DAY_MS))
    }
  })

  it('never postpones an urgent card', async () => {
    for (let i = 0; i < 8; i++) await seedCard({ importance: 'urgent' })
    start = build({ budgetMinutes: 1 })
    const result = await started()
    expect(result.postponed).toBe(0)
    expect(store.reviewLogs.all()).toHaveLength(0)
    expect(result.plan?.overload.stillOverBudget).toBe(true)
  })

  it('buries the sibling of a card already reviewed today', async () => {
    const item = await seedItem()
    const reviewed = await seedCard({ item })
    const sibling = await seedCard({ item })

    // A review earlier today, before the session was composed.
    const firstRun = await started()
    firstRun.runner.next()
    await firstRun.runner.answer(RATING.Good)
    await firstRun.runner.finish()

    clock.advance(60_000)
    start = build()
    const second = await started()

    expect(second.burials).toBe(1)
    const buried = (await store.cards.findById(sibling.id)) as Card
    expect(buried.buriedUntil).not.toBeNull()
    expect(cardIdsOf(second)).not.toContain(sibling.id)
    expect(reviewed.id).not.toBe(sibling.id)
  })
})

describe('the finish summary', () => {
  it('reports what was done, and closes the row', async () => {
    await seedCard()
    await seedCard()
    await seedCard()
    await seedCard()
    const { runner, session } = await started()

    for (const rating of [RATING.Good, RATING.Again, RATING.Hard, RATING.Easy]) {
      runner.next()
      clock.advance(5_000)
      await runner.answer(rating)
    }
    const summary = await runner.finish()

    expect(summary.reviewed).toBe(4)
    expect(summary.again).toBe(1)
    expect(summary.hard).toBe(1)
    // Only `Again` counts as wrong (§13, true retention).
    expect(summary.accuracy).toBeCloseTo(0.75, 10)
    expect(summary.minutes).toBeCloseTo(20_000 / 60_000, 10)
    expect(summary.postponed).toBe(0)
    // The gamification ports are the honest no-ops until sub-phase 13.1.
    expect(summary.xp).toBe(0)
    expect(summary.streak).toMatchObject({ state: 'unknown', goalCards: 10, reviewedToday: 4 })

    const stored = await store.reviewSessions.findById(session.id)
    expect(stored?.status).toBe('completed')
    expect(stored?.reviewed).toBe(4)
    expect(stored?.accuracy).toBeCloseTo(0.75, 10)
    expect(stored?.finishedAt).not.toBeNull()
  })

  it('reports a null accuracy when nothing was answered', async () => {
    await seedCard()
    const { runner } = await started()
    const summary = await runner.finish()
    expect(summary.reviewed).toBe(0)
    expect(summary.accuracy).toBeNull()
  })
})
