import { describe, expect, it } from 'vitest'
import { contract } from '../index'
import { forecastSchema } from './memory'
import {
  REVIEW_SESSION_STATUSES,
  SESSION_ENTRY_KINDS,
  SESSION_ORDERS,
  sessionEntrySchema,
  sessionPlanSchema,
  sessionSummarySchema,
} from './session'

const ID = '019213cd-0000-7000-8000-000000000001'
const AT = '2026-09-02T00:00:00.000Z'

const overload = {
  plannedCards: 50,
  keptCards: 10,
  postponedCards: 40,
  completedShare: 0.2,
  byLevel: [{ level: 'maintenance' as const, count: 40 }],
  budgetMinutes: 10,
  estimatedMinutes: 10,
  overloaded: true,
  stillOverBudget: false,
}

const plan = {
  counts: { exam: 0, due: 35, relearning: 2, new: 8, reinforcement: 1, total: 46 },
  overload,
  postponements: 40,
  burials: 1,
  estimatedMinutes: 12,
  budgetMinutes: 20,
  streakGoalCards: 10,
  medianSecondsPerCard: 8,
  backlogDays: 1.2,
  newGated: false,
  finalDrill: false,
  order: 'relative_overdueness' as const,
  seed: '20605',
  composedAt: AT,
}

const progress = {
  sessionId: ID,
  cursor: 3,
  total: 46,
  remaining: 43,
  reviewed: 3,
  again: 1,
  hard: 0,
  skipped: 0,
  drillPending: 1,
  drillStarted: false,
  finished: false,
}

describe('session vocabulary', () => {
  /** The same drift guard as the importance levels: this package cannot import
   *  `@retenia/core`, so the lists are asserted against the spec's words instead. */
  it('mirrors the domain vocabulary core and the database enforce', () => {
    expect([...SESSION_ENTRY_KINDS]).toEqual(['exam', 'due', 'relearning', 'new', 'reinforcement'])
    expect([...SESSION_ORDERS]).toEqual(['relative_overdueness', 'retrievability'])
    expect([...REVIEW_SESSION_STATUSES]).toEqual(['in_progress', 'completed', 'abandoned'])
  })
})

describe('session.plan', () => {
  it('round-trips a plan', () => {
    expect(sessionPlanSchema.parse(plan)).toEqual(plan)
  })

  it('rejects a completed share outside 0–1', () => {
    expect(() =>
      sessionPlanSchema.parse({ ...plan, overload: { ...overload, completedShare: 1.5 } }),
    ).toThrow()
  })

  it('takes stored settings when given nothing', () => {
    expect(contract['session.plan'].input.parse({})).toEqual({})
  })

  it('bounds the per-session overrides the way the settings registry does', () => {
    const { input } = contract['session.plan']
    expect(() => input.parse({ budgetMinutes: 0 })).toThrow()
    expect(() => input.parse({ budgetMinutes: 2000 })).toThrow()
    // §12 step 4's "1 new every 3–5 reviews".
    expect(() => input.parse({ newEveryNReviews: 2 })).toThrow()
    expect(() => input.parse({ newEveryNReviews: 6 })).toThrow()
    expect(input.parse({ newEveryNReviews: 4 })).toEqual({ newEveryNReviews: 4 })
  })
})

describe('session.start', () => {
  it('refuses an unconfirmed start at the bridge — it applies burials and postpones', () => {
    const { input } = contract['session.start']
    expect(() => input.parse({})).toThrow()
    expect(() => input.parse({ confirm: false })).toThrow()
    expect(input.parse({ confirm: true })).toEqual({ confirm: true })
  })
})

describe('session.next', () => {
  const card = {
    id: ID,
    itemId: '019213cd-0000-7000-8000-000000000002',
    template: 'basic',
    payload: null,
    state: 2 as const,
    due: AT,
    stability: 12.3,
    difficulty: 5.2,
    scheduledDays: 10,
    learningSteps: 0,
    reps: 6,
    lapses: 1,
    lastReview: AT,
  }

  it('round-trips a card entry and a reinforcement node', () => {
    const entry = {
      kind: 'due' as const,
      card,
      level: 'normal' as const,
      retrievability: 0.82,
      desiredRetention: 0.9,
      examId: null,
    }
    expect(sessionEntrySchema.parse(entry)).toEqual(entry)

    const node = {
      kind: 'reinforcement' as const,
      node: { id: 'L07.r1', lessonId: 'L07', pathId: null, estimatedMinutes: 5 },
    }
    expect(sessionEntrySchema.parse(node)).toEqual(node)
  })

  it('allows null for the whole entry once the queue is done', () => {
    const { output } = contract['session.next']
    expect(output.parse({ entry: null, progress }).entry).toBeNull()
  })
})

describe('session.answer', () => {
  const { input } = contract['session.answer']

  it('takes the four grades only — Manual is never an answer', () => {
    for (const rating of [1, 2, 3, 4]) expect(input.parse({ rating }).rating).toBe(rating)
    expect(() => input.parse({ rating: 0 })).toThrow()
    expect(() => input.parse({ rating: 5 })).toThrow()
  })

  it('bounds the grader score and the duration', () => {
    expect(() => input.parse({ rating: 3, exerciseScore: 1.2 })).toThrow()
    expect(() => input.parse({ rating: 3, durationMs: -1 })).toThrow()
    expect(input.parse({ rating: 3, exerciseScore: 0.8, durationMs: 4200 })).toMatchObject({
      exerciseScore: 0.8,
      durationMs: 4200,
    })
  })
})

describe('session.finish', () => {
  it('round-trips a summary, with a null accuracy when nothing was answered', () => {
    const summary = {
      sessionId: ID,
      reviewed: 0,
      again: 0,
      hard: 0,
      skipped: 0,
      accuracy: null,
      minutes: 0,
      xp: 0,
      postponed: 0,
      streak: {
        state: 'unknown' as const,
        current: 0,
        goalCards: 10,
        reviewedToday: 0,
        goalMet: false,
      },
      overload,
      finishedAt: AT,
    }
    expect(sessionSummarySchema.parse(summary)).toEqual(summary)
  })
})

describe('memory.forecast', () => {
  const { input } = contract['memory.forecast']

  it('bounds the window to a year', () => {
    expect(input.parse({ days: 30 })).toEqual({ days: 30 })
    expect(input.parse({ days: 365 })).toEqual({ days: 365 })
    expect(() => input.parse({ days: 0 })).toThrow()
    expect(() => input.parse({ days: 366 })).toThrow()
  })

  it('round-trips a day, with and without new', () => {
    const forecast = {
      days: [
        {
          day: '2026-09-02',
          offset: 0,
          byLevel: { urgent: 1, high: 0, normal: 12, maintenance: 3, paused: 0 },
          cards: 16,
          minutes: 2.13,
          newCards: 8,
          cardsWithNew: 24,
          minutesWithNew: 3.2,
        },
      ],
      medianSecondsPerCard: 8,
      backlog: 4,
      newPool: 40,
      dailyNewLimit: 15,
      generatedAt: AT,
    }
    expect(forecastSchema.parse(forecast)).toEqual(forecast)
    expect(() =>
      forecastSchema.parse({ ...forecast, days: [{ ...forecast.days[0], day: 'x' }] }),
    ).toThrow()
  })
})
