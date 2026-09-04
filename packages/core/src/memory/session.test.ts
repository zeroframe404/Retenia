import { beforeEach, describe, expect, it } from 'vitest'
import type { Card, ImportanceLevel } from '../entities'
import { cardFixture, knowledgeItemFixture } from '../testing/memory-fixtures'
import { createFsrsScheduler } from './fsrs-scheduler'
import { DEFAULT_IMPORTANCE_CATALOG } from './importance'
import { DEFAULT_SCHEDULING_OPTIONS } from './parameters'
import { resolveImportance } from './scheduling-policy'
import {
  composeSession,
  disperseSiblings,
  NEW_GATING_BACKLOG_DAYS,
  relativeOverdueness,
  resolveSessionSettings,
  type SessionCandidate,
  type SessionCardEntry,
  type SessionPlan,
  type SessionSettings,
} from './session'
import type { ExamQueueEntry } from './session-ports'
import { siblingBurialUntil } from './siblings'
import { DAY_MS } from './study-day'
import { CARD_STATE } from './types'

/**
 * The daily session composer (`docs/spec/02-memory-system.md` §12).
 *
 * A frozen `NOW` and hand-built candidates rather than a clock: every assertion here is
 * about *order*, and an order that depended on wall-clock time could not be asserted at all.
 */

const NOW = new Date('2026-06-01T12:00:00Z')
const scheduler = createFsrsScheduler({ dayStartHour: 0 })

let sequence = 0
function nextId(prefix: string): string {
  sequence += 1
  return `019a0000-0000-7000-8000-${prefix}${String(sequence).padStart(8, '0')}`
}

interface CandidateSpec {
  level?: ImportanceLevel
  /** Days since the last review. */
  elapsedDays?: number
  /** The interval that was in force. */
  scheduledDays?: number
  stability?: number
  state?: Card['state']
  itemId?: string
  cardId?: string
  due?: Date
  suspended?: boolean
}

function candidate(spec: CandidateSpec = {}): SessionCandidate {
  const level = spec.level ?? 'normal'
  const itemId = spec.itemId ?? nextId('aaaa')
  const scheduledDays = spec.scheduledDays ?? 10
  const elapsedDays = spec.elapsedDays ?? 12
  const state = spec.state ?? CARD_STATE.Review
  const item = knowledgeItemFixture({ id: itemId, importance: level })
  const card = cardFixture({
    id: spec.cardId ?? nextId('cccc'),
    itemId,
    state,
    stability: spec.stability ?? 20,
    difficulty: 5,
    scheduledDays,
    reps: 4,
    lastReview: state === CARD_STATE.New ? null : new Date(NOW.getTime() - elapsedDays * DAY_MS),
    due: spec.due ?? new Date(NOW.getTime() - (elapsedDays - scheduledDays) * DAY_MS),
    ...(spec.suspended === undefined ? {} : { suspended: spec.suspended }),
  })
  return { card, item, resolution: resolveImportance({ card, item, now: NOW }) }
}

function plan(
  due: readonly SessionCandidate[],
  settings: SessionSettings = {},
  extra: Partial<Parameters<typeof composeSession>[0]> = {},
): SessionPlan {
  return composeSession({
    now: NOW,
    settings: resolveSessionSettings({ budgetMinutes: 60, ...settings }),
    due,
    newCards: [],
    scheduler,
    catalog: DEFAULT_IMPORTANCE_CATALOG,
    dayBoundary: { dayStartHour: 0 },
    ...extra,
  })
}

const cardEntries = (result: SessionPlan): SessionCardEntry[] =>
  result.entries.filter((entry): entry is SessionCardEntry => entry.kind !== 'reinforcement')

const levelsOf = (result: SessionPlan): ImportanceLevel[] =>
  cardEntries(result).map((entry) => entry.level)

beforeEach(() => {
  sequence = 0
})

describe('§12 step 2 — due cards by level', () => {
  it('orders urgent → high → normal → maintenance, and drops paused', () => {
    const result = plan([
      candidate({ level: 'maintenance' }),
      candidate({ level: 'paused' }),
      candidate({ level: 'normal' }),
      candidate({ level: 'urgent' }),
      candidate({ level: 'high' }),
    ])
    expect(levelsOf(result)).toEqual(['urgent', 'high', 'normal', 'maintenance'])
  })

  it('orders by relative overdueness inside a level, most overdue first', () => {
    // 30/10 = 3.0, 12/10 = 1.2, 11/10 = 1.1 — deliberately not the same order as the raw
    // elapsed days would give if the intervals were ignored.
    const barely = candidate({ cardId: nextId('0001'), elapsedDays: 11, scheduledDays: 10 })
    const veryOverdue = candidate({ cardId: nextId('0002'), elapsedDays: 30, scheduledDays: 10 })
    const middling = candidate({ cardId: nextId('0003'), elapsedDays: 12, scheduledDays: 10 })

    const result = plan([barely, veryOverdue, middling])
    expect(cardEntries(result).map((entry) => entry.card.id)).toEqual([
      veryOverdue.card.id,
      middling.card.id,
      barely.card.id,
    ])
    expect(cardEntries(result)[0]?.relativeOverdueness).toBeCloseTo(3, 10)
  })

  it('a long interval barely past due sorts after a short one well past due', () => {
    // 400 days elapsed on a 365-day interval is 1.1; 3 days on a 1-day interval is 3.0.
    const yearly = candidate({ elapsedDays: 400, scheduledDays: 365 })
    const daily = candidate({ elapsedDays: 3, scheduledDays: 1 })
    const result = plan([yearly, daily])
    expect(cardEntries(result).map((entry) => entry.card.id)).toEqual([
      daily.card.id,
      yearly.card.id,
    ])
  })

  it('order: "retrievability" switches to ascending R instead', () => {
    const strong = candidate({ elapsedDays: 11, scheduledDays: 10, stability: 400 })
    const weak = candidate({ elapsedDays: 12, scheduledDays: 10, stability: 1 })

    const byOverdueness = plan([strong, weak])
    // 12/10 beats 11/10, so overdueness puts the weak card first here too — the point is
    // that the *keys* differ, so assert on R directly.
    expect(cardEntries(byOverdueness)[0]?.card.id).toBe(weak.card.id)

    const byR = plan([strong, weak], { order: 'retrievability' })
    const entries = cardEntries(byR)
    expect(entries[0]?.card.id).toBe(weak.card.id)
    expect(entries[0]?.retrievability).toBeLessThan(entries[1]?.retrievability as number)
  })

  it('treats a card with no interval to be overdue against as maximally overdue', () => {
    expect(relativeOverdueness(cardFixture({ lastReview: null }), NOW)).toBe(
      Number.POSITIVE_INFINITY,
    )
    expect(
      relativeOverdueness(
        cardFixture({ lastReview: new Date(NOW.getTime() - DAY_MS), scheduledDays: 0 }),
        NOW,
      ),
    ).toBe(Number.POSITIVE_INFINITY)
  })

  it('is a total order: two identical cards still come out in a fixed sequence', () => {
    const a = candidate({ cardId: '019a0000-0000-7000-8000-0000000000a1' })
    const b = candidate({ cardId: '019a0000-0000-7000-8000-0000000000a2' })
    expect(cardEntries(plan([b, a])).map((e) => e.card.id)).toEqual([a.card.id, b.card.id])
    expect(cardEntries(plan([a, b])).map((e) => e.card.id)).toEqual([a.card.id, b.card.id])
  })
})

describe('§4 — siblings', () => {
  it('never places two cards of the same item next to each other', () => {
    const item = nextId('5555')
    const due = [
      ...Array.from({ length: 4 }, () => candidate({ itemId: item })),
      ...Array.from({ length: 4 }, () => candidate({})),
    ]
    const ids = cardEntries(plan(due)).map((entry) => entry.card.itemId)
    expect(ids).toHaveLength(8)
    for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1])
  })

  it('emits every entry even when dispersion is impossible', () => {
    const item = nextId('6666')
    const due = Array.from({ length: 3 }, () => candidate({ itemId: item }))
    // Nothing else to interleave with: adjacency is unavoidable, and dropping cards would
    // be worse than showing them.
    expect(cardEntries(plan(due))).toHaveLength(3)
  })

  it('disperseSiblings keeps the primary order where adjacency allows', () => {
    const entries = [
      { card: { id: 'a', itemId: 'x' } },
      { card: { id: 'b', itemId: 'x' } },
      { card: { id: 'c', itemId: 'y' } },
      { card: { id: 'd', itemId: 'z' } },
    ] as unknown as SessionCardEntry[]
    expect(disperseSiblings(entries).map((entry) => entry.card.id)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('buries a sibling to the next study day when the item was already reviewed today', () => {
    const item = nextId('7777')
    const reviewed = candidate({ itemId: item })
    const sibling = candidate({ itemId: item })
    const unrelated = candidate({})

    const result = plan(
      [reviewed, sibling, unrelated],
      {},
      {
        reviewedTodayItemIds: new Set([item]),
        reviewedTodayCardIds: new Set([reviewed.card.id]),
      },
    )

    // The card that was reviewed keeps its place (it is due again on its own steps); its
    // sibling is held back rather than giving the answer away.
    //
    // Until the *start of the next study day*, not `now + 24 h`: reviewing at 23:00 with a
    // flat day's offset would hide the sibling until 23:00 tomorrow, which is past
    // tomorrow's session, and the card would silently skip a day.
    expect(result.burials).toEqual([
      {
        cardId: sibling.card.id,
        itemId: item,
        until: siblingBurialUntil(NOW, { dayStartHour: 0 }),
      },
    ])
    // The harness runs with a midnight rollover, so 'the next study day' is midnight; with
    // the product default of 4 a.m. the same review would bury until 04:00.
    expect(siblingBurialUntil(NOW, { dayStartHour: 0 })).toEqual(new Date('2026-06-02T00:00:00Z'))
    expect(siblingBurialUntil(NOW)).toEqual(new Date('2026-06-02T04:00:00Z'))
    expect(cardEntries(result).map((e) => e.card.id)).not.toContain(sibling.card.id)
    expect(cardEntries(result).map((e) => e.card.id)).toContain(unrelated.card.id)
  })

  it('never buries a card mid-way through its learning steps', () => {
    const item = nextId('8888')
    const learning = candidate({ itemId: item, state: CARD_STATE.Learning })
    const result = plan([learning], {}, { reviewedTodayItemIds: new Set([item]) })
    expect(result.burials).toEqual([])
    expect(cardEntries(result)).toHaveLength(1)
  })
})

describe('§12 step 3 — relearning', () => {
  it('interleaves a relearning card at the position its step timer falls due', () => {
    const due = Array.from({ length: 20 }, () => candidate({}))
    // 8 s a card, a step 80 s out ⇒ ten cards ahead of it.
    const relearning = candidate({
      state: CARD_STATE.Relearning,
      due: new Date(NOW.getTime() + 80_000),
    })
    const result = plan([...due, relearning], { medianSecondsPerCard: 8 })
    const kinds = cardEntries(result).map((entry) => entry.kind)
    expect(kinds.indexOf('relearning')).toBe(10)
    expect(result.counts.relearning).toBe(1)
  })

  it('puts a step that has already fired at the front', () => {
    const due = Array.from({ length: 5 }, () => candidate({}))
    const relearning = candidate({
      state: CARD_STATE.Relearning,
      due: new Date(NOW.getTime() - 60_000),
    })
    expect(
      cardEntries(plan([...due, relearning]))
        .map((e) => e.kind)
        .indexOf('relearning'),
    ).toBe(0)
  })
})

describe('§12 step 4 — new cards', () => {
  const newCard = (level: ImportanceLevel = 'normal'): SessionCandidate =>
    candidate({ level, state: CARD_STATE.New, due: NOW })

  it('introduces one new card every N reviews', () => {
    const due = Array.from({ length: 12 }, () => candidate({}))
    const fresh = Array.from({ length: 3 }, () => newCard())
    const result = plan(due, { newEveryNReviews: 4 }, { newCards: fresh })
    const kinds = cardEntries(result).map((entry) => entry.kind)
    expect(kinds.filter((kind) => kind === 'new')).toHaveLength(3)
    // Positions 4, 9 and 14 once the earlier insertions have shifted everything along.
    expect([kinds[4], kinds[9], kinds[14]]).toEqual(['new', 'new', 'new'])
  })

  it('respects the per-level quota and the overall daily limit', () => {
    const fresh = Array.from({ length: 40 }, () => newCard('normal'))
    // maintenance introduces nothing at all (§7: "0 — review only").
    const maintenance = Array.from({ length: 5 }, () => newCard('maintenance'))
    const result = plan(
      Array.from({ length: 60 }, () => candidate({})),
      { dailyNewLimit: 8 },
      { newCards: [...fresh, ...maintenance] },
    )
    expect(result.counts.new).toBe(8)
    expect(cardEntries(result).every((e) => e.kind !== 'new' || e.level === 'normal')).toBe(true)
  })

  it('withholds new cards once the backlog passes 1.5 days of capacity', () => {
    // 60 minutes at 8 s a card is 450 cards of capacity; 700 due is ~1.56 days.
    const due = Array.from({ length: 700 }, () => candidate({}))
    const result = plan(
      due,
      { medianSecondsPerCard: 8, budgetMinutes: 60 },
      {
        newCards: [newCard('normal'), newCard('high')],
      },
    )
    expect(result.backlogDays).toBeGreaterThan(NEW_GATING_BACKLOG_DAYS)
    expect(result.newGated).toBe(true)
    expect(result.counts.new).toBe(0)
  })

  it('keeps introducing urgent cards under that backlog — urgent has no cap', () => {
    const due = Array.from({ length: 700 }, () => candidate({}))
    const result = plan(
      due,
      { medianSecondsPerCard: 8, budgetMinutes: 60 },
      {
        newCards: [newCard('normal'), newCard('urgent'), newCard('urgent')],
      },
    )
    expect(result.newGated).toBe(true)
    expect(result.counts.new).toBe(2)
    expect(
      cardEntries(result)
        .filter((entry) => entry.kind === 'new')
        .every((entry) => entry.level === 'urgent'),
    ).toBe(true)
  })
})

describe('§12 steps 1 and 5 — exams and the reinforcement node', () => {
  it('puts the exam queue first, by ascending R_E then blueprint weight', () => {
    const light = candidate({})
    const heavy = candidate({})
    const weak = candidate({})
    const examQueue: ExamQueueEntry[] = [
      {
        card: light.card,
        examId: 'e1',
        examRetrievability: 0.8,
        topicWeight: 0.1,
        level: 'urgent',
        options: DEFAULT_SCHEDULING_OPTIONS,
      },
      {
        card: heavy.card,
        examId: 'e1',
        examRetrievability: 0.8,
        topicWeight: 0.9,
        level: 'urgent',
        options: DEFAULT_SCHEDULING_OPTIONS,
      },
      {
        card: weak.card,
        examId: 'e1',
        examRetrievability: 0.2,
        topicWeight: 0,
        level: 'urgent',
        options: DEFAULT_SCHEDULING_OPTIONS,
      },
    ]
    const result = plan([candidate({ level: 'urgent' })], {}, { examQueue })
    const entries = cardEntries(result)
    expect(entries.slice(0, 3).map((entry) => entry.card.id)).toEqual([
      weak.card.id,
      heavy.card.id,
      light.card.id,
    ])
    expect(entries.slice(0, 3).every((entry) => entry.kind === 'exam')).toBe(true)
    expect(result.counts.exam).toBe(3)
  })

  it('never queues an exam card twice', () => {
    const shared = candidate({})
    const result = plan(
      [shared],
      {},
      {
        examQueue: [
          {
            card: shared.card,
            examId: 'e1',
            examRetrievability: 0.5,
            topicWeight: 0,
            level: 'urgent',
            options: DEFAULT_SCHEDULING_OPTIONS,
          },
        ],
      },
    )
    expect(cardEntries(result)).toHaveLength(1)
    expect(result.counts.due).toBe(0)
  })

  it('appends the reinforcement node and charges it against the estimate', () => {
    const result = plan(
      [candidate({})],
      { medianSecondsPerCard: 60 },
      {
        reinforcement: { id: 'r1', lessonId: 'L07', pathId: 'p1', estimatedMinutes: 5 },
      },
    )
    expect(result.entries.at(-1)).toEqual({
      kind: 'reinforcement',
      node: { id: 'r1', lessonId: 'L07', pathId: 'p1', estimatedMinutes: 5 },
    })
    expect(result.counts.reinforcement).toBe(1)
    expect(result.estimatedMinutes).toBeCloseTo(6, 10)
  })
})

describe('the plan as a whole', () => {
  it('reports the budget, the streak goal and the median it used', () => {
    const result = plan([candidate({})], {
      budgetMinutes: 25,
      streakGoalCards: 10,
      medianSecondsPerCard: 12,
    })
    expect(result.budgetMinutes).toBe(25)
    expect(result.streakGoalCards).toBe(10)
    expect(result.medianSecondsPerCard).toBe(12)
    expect(result.estimatedMinutes).toBeCloseTo(0.2, 10)
  })

  it('falls back to the spec’s 8 s when no median was measured', () => {
    expect(resolveSessionSettings({}).medianSecondsPerCard).toBe(8)
    expect(resolveSessionSettings({ streakGoalCards: undefined }).streakGoalCards).toBe(10)
  })

  it('clamps "1 new every 3–5 reviews" to the spec’s range', () => {
    expect(resolveSessionSettings({ newEveryNReviews: 1 }).newEveryNReviews).toBe(3)
    expect(resolveSessionSettings({ newEveryNReviews: 9 }).newEveryNReviews).toBe(5)
  })

  it('is deterministic: the same input composes the same plan twice', () => {
    const due = Array.from({ length: 50 }, () =>
      candidate({ level: (['urgent', 'high', 'normal'] as const)[sequence % 3] }),
    )
    const first = plan(due, { seed: 'fixed' })
    const second = plan([...due].reverse(), { seed: 'fixed' })
    expect(cardEntries(second).map((e) => e.card.id)).toEqual(
      cardEntries(first).map((e) => e.card.id),
    )
    expect(second.seed).toBe('fixed')
  })

  it('defaults the seed to the study day, so today always composes the same way', () => {
    // 2026-06-01, as days since the epoch, with the day starting at midnight UTC.
    expect(plan([candidate({})]).seed).toBe('20605')
  })
})

describe('throughput', () => {
  /**
   * The sub-phase's budget: a 2,000-card backlog composes in under 100 ms.
   *
   * Warm-up then best of three, as `fsrs-scheduler.test.ts` does — a single cold run on a
   * shared CI runner measures JIT warm-up, not the composer. The work is one `retrievability`
   * per card plus an O(n log n) sort, which is a few milliseconds, so the budget has enough
   * headroom to be asserted outright rather than as a ratio; `session.bench.ts` tracks the
   * real number.
   */
  it('composes a 2,000-card backlog in under 100 ms (best of three)', () => {
    const clock = (globalThis as unknown as { performance: { now(): number } }).performance
    const levels = ['urgent', 'high', 'normal', 'maintenance'] as const
    const due = Array.from({ length: 2_000 }, (_, i) =>
      candidate({
        level: levels[i % levels.length] as ImportanceLevel,
        elapsedDays: 5 + (i % 40),
        scheduledDays: 1 + (i % 20),
        itemId: `019a0000-0000-7000-8000-item${String(Math.floor(i / 2)).padStart(8, '0')}`,
      }),
    )
    const settings = resolveSessionSettings({ budgetMinutes: 600 })
    const run = (): SessionPlan =>
      composeSession({
        now: NOW,
        settings,
        due,
        newCards: [],
        scheduler,
        catalog: DEFAULT_IMPORTANCE_CATALOG,
        dayBoundary: { dayStartHour: 0 },
      })

    for (let i = 0; i < 5; i++) run()
    let best = Number.POSITIVE_INFINITY
    for (let trial = 0; trial < 3; trial++) {
      const start = clock.now()
      run()
      best = Math.min(best, clock.now() - start)
    }
    expect(run().counts.due).toBe(2_000)
    expect(best).toBeLessThan(100)
  })
})
