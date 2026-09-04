import { beforeEach, describe, expect, it } from 'vitest'
import type { Card, ImportanceLevel, KnowledgeItem } from '../entities'
import { SETTINGS_DEFAULTS, type SettingsKey, type SettingsMap } from '../ports/settings-repository'
import { type FakeClock, fakeClock } from '../testing/in-memory-job-repository'
import {
  createInMemoryReviewStore,
  type InMemoryReviewStore,
} from '../testing/in-memory-review-store'
import { createForecast, type ForecastQuery } from './forecast'
import { DAY_MS } from './study-day'
import { CARD_STATE } from './types'

/** §13's "Forecast" row: cards and minutes per day, per level, with and without new. */

const NOW = new Date('2026-06-01T12:00:00Z')
const DAY_BOUNDARY = { dayStartHour: 0 }

let clock: FakeClock
let store: InMemoryReviewStore
let forecast: ForecastQuery
let sequence: number

const settingsRepo = {
  get: <K extends SettingsKey>(key: K): Promise<SettingsMap[K]> =>
    Promise.resolve(SETTINGS_DEFAULTS[key]),
}

function id(prefix: string): string {
  sequence += 1
  return `019a0000-0000-7000-8000-${prefix}${String(sequence).padStart(8, '0')}`
}

async function seed(
  dueOffsetDays: number,
  importance: ImportanceLevel = 'normal',
  state: Card['state'] = CARD_STATE.Review,
): Promise<void> {
  const item: KnowledgeItem = await store.knowledgeItems.create({
    id: id('aaaa'),
    lessonId: null,
    topicId: null,
    kind: 'fact',
    fields: {},
    sourceId: null,
    annotationId: null,
    locator: null,
    asOf: null,
    importance,
    status: 'active',
    createdBy: 'user',
    tags: [],
  })
  await store.cards.create({
    id: id('cccc'),
    itemId: item.id,
    template: 'basic',
    payload: null,
    due: new Date(NOW.getTime() + dueOffsetDays * DAY_MS),
    stability: 10,
    difficulty: 5,
    scheduledDays: 10,
    learningSteps: 0,
    reps: state === CARD_STATE.New ? 0 : 3,
    lapses: 0,
    state,
    lastReview: state === CARD_STATE.New ? null : new Date(NOW.getTime() - DAY_MS),
    suspended: false,
    buriedUntil: null,
    leech: false,
    importanceOverride: null,
    importanceOverrideExpiresAt: null,
    examId: null,
  })
}

beforeEach(() => {
  sequence = 0
  clock = fakeClock(NOW.getTime())
  store = createInMemoryReviewStore(clock)
  forecast = createForecast({
    repos: { ...store, settings: settingsRepo },
    clock,
    dayBoundary: DAY_BOUNDARY,
  })
})

describe('createForecast', () => {
  it('buckets cards by study day and reports minutes at the median', async () => {
    await seed(0)
    await seed(0)
    await seed(2)
    const result = await forecast(7)

    expect(result.days).toHaveLength(7)
    expect(result.days[0]?.cards).toBe(2)
    expect(result.days[1]?.cards).toBe(0)
    expect(result.days[2]?.cards).toBe(1)
    // No history yet, so the 8 s fallback: two cards is 16 s.
    expect(result.medianSecondsPerCard).toBe(8)
    expect(result.days[0]?.minutes).toBeCloseTo(16 / 60, 10)
    expect(result.days.map((day) => day.offset)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(result.days[0]?.day).toBe('2026-06-01')
  })

  it('splits each day by level, with every level present', async () => {
    await seed(1, 'urgent')
    await seed(1, 'normal')
    await seed(1, 'normal')
    const day = (await forecast(3)).days[1]
    expect(day?.byLevel).toEqual({ urgent: 1, high: 0, normal: 2, maintenance: 0, paused: 0 })
  })

  it('counts everything already overdue into today', async () => {
    await seed(-30)
    await seed(-1)
    await seed(0)
    const result = await forecast(5)
    expect(result.backlog).toBe(2)
    expect(result.days[0]?.cards).toBe(3)
  })

  it('projects new introductions separately — with and without new', async () => {
    await seed(0)
    for (let i = 0; i < 40; i++) await seed(0, 'normal', CARD_STATE.New)
    const result = await forecast(4)

    expect(result.newPool).toBe(40)
    expect(result.dailyNewLimit).toBe(15)
    // New cards are never counted as scheduled reviews…
    expect(result.days[0]?.cards).toBe(1)
    // …but the quota introduces 15, 15, then the last 10, and nothing after.
    expect(result.days.map((day) => day.newCards)).toEqual([15, 15, 10, 0])
    expect(result.days[0]?.cardsWithNew).toBe(16)
    expect(result.days[3]?.cardsWithNew).toBe(0)
    expect(result.days[0]?.minutesWithNew).toBeCloseTo((16 * 8) / 60, 10)
  })

  it('leaves paused and suspended cards out entirely', async () => {
    await seed(0, 'paused')
    await seed(0)
    const cards = store.cards.all()
    await store.cards.update(cards[1]?.id as string, { suspended: true })
    expect((await forecast(2)).days[0]?.cards).toBe(0)
  })

  it('uses the measured median once there is history', async () => {
    await seed(0)
    const card = store.cards.all()[0] as Card
    for (const durationMs of [4_000, 20_000, 12_000]) {
      await store.reviewLogs.append({
        cardId: card.id,
        rating: 3,
        state: 2,
        due: NOW,
        stability: 10,
        difficulty: 5,
        elapsedDays: 1,
        scheduledDays: 10,
        learningSteps: 0,
        review: NOW,
        durationMs,
        context: 'daily',
        exerciseScore: null,
        device: null,
        attemptId: null,
        algorithmVersion: 'fsrs6',
      })
    }
    // The middle value, not the mean — one card left open for 20 s must not skew the day.
    expect((await forecast(1)).medianSecondsPerCard).toBe(12)
  })

  it('rejects a window of less than a day and caps a very long one', async () => {
    await expect(forecast(0)).rejects.toThrow(/at least 1/)
    expect((await forecast(10_000)).days).toHaveLength(365)
  })
})
