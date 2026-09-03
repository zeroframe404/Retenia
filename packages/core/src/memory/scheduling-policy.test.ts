import { describe, expect, it } from 'vitest'
import type { ImportanceLevel } from '../entities'
import { cardFixture, examFixture, knowledgeItemFixture } from '../testing/memory-fixtures'
import { createExamOverrides } from './exam-override'
import { createFsrsScheduler } from './fsrs-scheduler'
import {
  createImportanceCatalog,
  DEFAULT_IMPORTANCE_CATALOG,
  URGENT_MODE_RETENTION,
  URGENT_MODE_STEPS,
} from './importance'
import { DEFAULT_SCHEDULING_OPTIONS } from './parameters'
import {
  createDefaultSchedulingPolicy,
  createImportanceResolver,
  createImportanceSchedulingPolicy,
  isUrgentModeActive,
  resolveImportance,
} from './scheduling-policy'
import { CARD_STATE, RATING } from './types'

const NOW = new Date('2026-01-05T08:00:00.000Z')

/** A `Review` card with S = 30 — what the required interval-ordering test grades. */
function matureCard(overrides = {}) {
  return cardFixture({
    state: CARD_STATE.Review,
    stability: 30,
    difficulty: 5,
    reps: 4,
    scheduledDays: 30,
    lastReview: new Date('2025-12-06T08:00:00.000Z'),
    due: NOW,
    ...overrides,
  })
}

function at(level: ImportanceLevel) {
  return { card: matureCard(), item: knowledgeItemFixture({ importance: level }), now: NOW }
}

describe('createDefaultSchedulingPolicy', () => {
  it('hands every card the same options, the spec defaults unless told otherwise', async () => {
    const policy = createDefaultSchedulingPolicy()
    const input = { card: cardFixture(), item: null, now: new Date() }
    expect(await policy.optionsFor(input)).toBe(DEFAULT_SCHEDULING_OPTIONS)
    const custom = createDefaultSchedulingPolicy({
      ...DEFAULT_SCHEDULING_OPTIONS,
      desiredRetention: 0.85,
    })
    expect((await custom.optionsFor(input)).desiredRetention).toBe(0.85)
  })

  it('refuses invalid options up front', () => {
    expect(() =>
      createDefaultSchedulingPolicy({ ...DEFAULT_SCHEDULING_OPTIONS, maxIntervalDays: 0 }),
    ).toThrow(RangeError)
  })
})

describe('resolveImportance: the level’s retention and cap', () => {
  it.each([
    ['urgent', 0.95, 180],
    ['high', 0.92, 365],
    ['normal', 0.9, 1825],
    ['maintenance', 0.85, 3650],
  ] as const)('asks %s for DR %s capped at %s days', (level, retention, cap) => {
    const { options } = resolveImportance(at(level))
    expect(options.desiredRetention).toBe(retention)
    expect(options.maxIntervalDays).toBe(cap)
  })

  /**
   * §7's whole point, in one assertion: a higher importance means a higher desired
   * retention, which means a shorter interval — the same card, the same stability, the
   * same grade, only the level differs.
   */
  it('books shorter intervals the more important the card is', () => {
    const scheduler = createFsrsScheduler()
    const policy = createImportanceSchedulingPolicy({
      base: { ...DEFAULT_SCHEDULING_OPTIONS, fuzz: false },
    })
    const intervals = (['urgent', 'high', 'normal', 'maintenance'] as const).map((level) => {
      const input = at(level)
      const options = policy.optionsFor(input) as ReturnType<typeof resolveImportance>['options']
      return scheduler.apply(input.card, NOW, RATING.Good, options).card.scheduledDays
    })
    expect(intervals).toEqual([...intervals].sort((a, b) => a - b))
    // …and they are genuinely different, not four equal numbers passing a sort check.
    expect(new Set(intervals).size).toBe(4)
  })

  it('takes `paused` out of the queue but still schedules it like Normal', () => {
    const resolution = resolveImportance(at('paused'))
    expect(resolution.queued).toBe(false)
    expect(resolution.options.desiredRetention).toBe(0.9)
    expect(resolution.options.maxIntervalDays).toBe(1825)
  })

  it('carries the level’s leech policy and rank through', () => {
    const { settings } = resolveImportance(at('maintenance'))
    expect(settings.leechAction).toBe('suspend')
    expect(settings.leechThreshold).toBe(8)
    expect(settings.orderRank).toBe(4)
  })
})

describe('resolveImportance: precedence', () => {
  it('falls back to Normal when the item is gone', () => {
    const resolution = resolveImportance({ card: matureCard(), item: null, now: NOW })
    expect(resolution.level).toBe('normal')
    expect(resolution.source).toBe('default')
  })

  it('lets the card’s override beat its item', () => {
    const resolution = resolveImportance({
      card: matureCard({ importanceOverride: 'high' }),
      item: knowledgeItemFixture({ importance: 'maintenance' }),
      now: NOW,
    })
    expect(resolution.level).toBe('high')
    expect(resolution.source).toBe('card_override')
    expect(resolution.options.desiredRetention).toBe(0.92)
  })

  it('lets an exam beat the item’s level (§7 rule 1: "the exam wins")', () => {
    const exam = examFixture({ date: '2026-01-19' })
    const resolution = resolveImportance(
      {
        card: matureCard({ examId: exam.id }),
        item: knowledgeItemFixture({ importance: 'maintenance' }),
        now: NOW,
      },
      { exams: createExamOverrides([exam]) },
    )
    expect(resolution.source).toBe('exam')
    expect(resolution.exam?.examId).toBe(exam.id)
    // Maintenance would have asked 0.85 over 3650 days; the exam asks 0.95 over 11.
    expect(resolution.options.desiredRetention).toBe(0.95)
    expect(resolution.options.maxIntervalDays).toBe(11)
    // The level itself is still the item's — the exam changes the request, not the label.
    expect(resolution.level).toBe('maintenance')
  })

  it('beats a card override too', () => {
    const exam = examFixture({ date: '2026-01-19' })
    const resolution = resolveImportance(
      {
        card: matureCard({ examId: exam.id, importanceOverride: 'maintenance' }),
        item: knowledgeItemFixture({ importance: 'normal' }),
        now: NOW,
      },
      { exams: createExamOverrides([exam]) },
    )
    expect(resolution.source).toBe('exam')
    expect(resolution.options.desiredRetention).toBe(0.95)
  })

  it('combines the two caps rather than choosing between them', () => {
    // Urgent caps at 180 days; an exam a year out caps at 362. The tighter one wins.
    const exam = examFixture({ date: '2027-01-02' })
    const resolution = resolveImportance(
      {
        card: matureCard({ examId: exam.id }),
        item: knowledgeItemFixture({ importance: 'urgent' }),
        now: NOW,
      },
      { exams: createExamOverrides([exam]) },
    )
    expect(resolution.options.maxIntervalDays).toBe(180)
  })

  it('takes an exam the caller already loaded, and `null` as "there is none"', () => {
    const exam = examFixture({ date: '2026-01-19' })
    const card = matureCard({ examId: exam.id })
    const item = knowledgeItemFixture({ importance: 'normal' })
    expect(resolveImportance({ card, item, now: NOW, exam }).source).toBe('exam')
    // `null` means "I looked, there is none" — the source is not consulted.
    expect(
      resolveImportance(
        { card, item, now: NOW, exam: null },
        { exams: createExamOverrides([exam]) },
      ).source,
    ).toBe('item')
  })

  it('measures an inline exam against the boundary it was given', () => {
    const exam = examFixture({ date: '2026-01-19' })
    const card = matureCard({ examId: exam.id })
    const resolution = resolveImportance(
      { card, item: null, now: NOW, exam },
      { dayBoundary: { timeZone: 'America/Argentina/Buenos_Aires' } },
    )
    expect(resolution.exam?.daysUntilExam).toBe(14)
  })
})

describe('resolveImportance: urgent mode (§7 rule 5)', () => {
  const expiring = (expiresAt: Date | null) =>
    matureCard({ importanceOverride: 'urgent' as const, importanceOverrideExpiresAt: expiresAt })

  it('asks for 0.97 and the same-day steps while the window is open', () => {
    const card = expiring(new Date(NOW.getTime() + 48 * 3_600_000))
    const resolution = resolveImportance({ card, item: knowledgeItemFixture(), now: NOW })
    expect(resolution.source).toBe('urgent_mode')
    expect(resolution.options.desiredRetention).toBe(URGENT_MODE_RETENTION)
    expect(resolution.options.learningSteps).toEqual([...URGENT_MODE_STEPS])
    expect(resolution.options.relearningSteps).toEqual([...URGENT_MODE_STEPS])
    expect(resolution.finalDrill).toBe(true)
    expect(resolution.urgentModeExpiresAt).toEqual(card.importanceOverrideExpiresAt)
  })

  /**
   * The expiry is honoured on read, not only by the sweep: a user who closes the app for a
   * week must not come back to a collection still reviewing at 0.97.
   */
  it('expires on its own, with no sweep run', () => {
    const expiresAt = new Date(NOW.getTime() + 48 * 3_600_000)
    const card = expiring(expiresAt)
    const item = knowledgeItemFixture({ importance: 'maintenance' })
    const later = new Date(expiresAt.getTime() + 1)

    expect(resolveImportance({ card, item, now: NOW }).options.desiredRetention).toBe(
      URGENT_MODE_RETENTION,
    )
    const after = resolveImportance({ card, item, now: later })
    expect(after.source).toBe('item')
    expect(after.level).toBe('maintenance')
    expect(after.options.desiredRetention).toBe(0.85)
    expect(after.finalDrill).toBe(false)
    expect(after.urgentModeExpiresAt).toBeNull()
    // The steps go back to the profile's, too.
    expect(after.options.learningSteps).toEqual([...DEFAULT_SCHEDULING_OPTIONS.learningSteps])
  })

  it('is exactly the expiry at the boundary instant', () => {
    const expiresAt = new Date(NOW.getTime() + 1000)
    expect(isUrgentModeActive(expiring(expiresAt), NOW)).toBe(true)
    expect(isUrgentModeActive(expiring(expiresAt), expiresAt)).toBe(false)
    expect(isUrgentModeActive(expiring(null), NOW)).toBe(false)
    expect(isUrgentModeActive(matureCard(), NOW)).toBe(false)
  })

  it('never lowers a level that already asks for more than 0.97', () => {
    const card = expiring(new Date(NOW.getTime() + 3_600_000))
    const catalog = createImportanceCatalog()
    const resolution = resolveImportance(
      { card, item: knowledgeItemFixture(), now: NOW },
      { catalog },
    )
    expect(resolution.options.desiredRetention).toBe(URGENT_MODE_RETENTION)
  })

  it('yields to an exam, which already asks for at least as much', () => {
    const exam = examFixture({ date: '2026-01-07' })
    const card = expiring(new Date(NOW.getTime() + 48 * 3_600_000))
    const resolution = resolveImportance(
      { card: { ...card, examId: exam.id }, item: knowledgeItemFixture(), now: NOW },
      { exams: createExamOverrides([exam]) },
    )
    expect(resolution.source).toBe('exam')
    expect(resolution.options.desiredRetention).toBe(URGENT_MODE_RETENTION)
  })
})

describe('createImportanceSchedulingPolicy', () => {
  it('reads the catalog it was given, not the spec defaults', async () => {
    const catalog = createImportanceCatalog([
      {
        id: '019a0000-0000-7000-8000-00000000f001',
        name: 'normal',
        desiredRetention: 0.93,
        maxIntervalDays: 400,
        orderRank: 3,
        postponeAllowed: true,
        newPerDay: 15,
        leechThreshold: 8,
        leechAction: 'edit',
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
        deviceId: 'test-device',
        version: 1,
      },
    ])
    const policy = createImportanceSchedulingPolicy({ catalog })
    const options = await policy.optionsFor(at('normal'))
    expect(options.desiredRetention).toBe(0.93)
    expect(options.maxIntervalDays).toBe(400)
  })

  it('carries the base options’ steps and fuzz through untouched', async () => {
    const base = {
      ...DEFAULT_SCHEDULING_OPTIONS,
      learningSteps: ['5m', '25m'] as const,
      fuzz: false,
    }
    const options = await createImportanceSchedulingPolicy({ base }).optionsFor(at('high'))
    expect(options.learningSteps).toEqual(['5m', '25m'])
    expect(options.fuzz).toBe(false)
  })

  /**
   * `FsrsScheduler` remembers a validated cache key per options *object*, so handing it the
   * same object for the same resolution skips the re-validation on every single review.
   */
  it('hands out one options object per distinct request', async () => {
    const policy = createImportanceSchedulingPolicy()
    const first = await policy.optionsFor(at('normal'))
    const second = await policy.optionsFor(at('normal'))
    expect(second).toBe(first)
    expect(await policy.optionsFor(at('urgent'))).not.toBe(first)
  })

  it('writes nothing and mutates nothing it is given', async () => {
    const card = Object.freeze(matureCard())
    const item = Object.freeze(knowledgeItemFixture())
    const policy = createImportanceSchedulingPolicy()
    await policy.optionsFor({ card, item, now: NOW })
    expect(card).toEqual(matureCard())
    expect(item).toEqual(knowledgeItemFixture())
  })
})

describe('createImportanceResolver', () => {
  it('is the full resolution over the same shared caches', () => {
    const resolve = createImportanceResolver({ catalog: DEFAULT_IMPORTANCE_CATALOG })
    const first = resolve(at('high'))
    expect(first.level).toBe('high')
    expect(resolve(at('high')).options).toBe(first.options)
  })
})
