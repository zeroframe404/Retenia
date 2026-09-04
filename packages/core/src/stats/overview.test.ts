import { describe, expect, it } from 'vitest'
import type { CardState, ImportanceLevel, Rating } from '../entities'
import { forgettingCurve } from '../memory/formulas'
import { DAY_MS, studyDayStart } from '../memory/study-day'
import { CARD_STATE } from '../memory/types'
import type {
  CardMemoryState,
  ReviewEvent,
  StatsReadOptions,
  StatsRepository,
} from '../ports/stats-repository'
import { createStatsQueries } from './overview'

/**
 * §13's first six rows, checked against a fixture whose every number is worked out by hand
 * in the comments below. The point of the exercise is the *filters*: true retention is only
 * trustworthy if the reviews that do not measure retention are actually thrown away, and
 * the only way to know they are is to count them out on paper first.
 */

const BOUNDARY = { dayStartHour: 4, timeZone: 'UTC' }
/** Today is 2026-06-15; the study day began at 04:00 UTC that morning. */
const NOW = new Date('2026-06-15T12:00:00.000Z')

interface EventSpec {
  card: string
  at: string
  state?: CardState
  scheduledDays: number
  rating: Rating
  level?: ImportanceLevel
}

function event(spec: EventSpec): ReviewEvent {
  const review = new Date(spec.at)
  return {
    cardId: spec.card,
    level: spec.level ?? 'normal',
    rating: spec.rating,
    state: spec.state ?? CARD_STATE.Review,
    scheduledDays: spec.scheduledDays,
    stability: 10,
    difficulty: 5,
    due: new Date(review.getTime() - spec.scheduledDays * DAY_MS),
    review,
    durationMs: 8_000,
    context: 'daily',
    activityType: null,
  }
}

/**
 * The fixture, oldest first — `listReviewEvents`' contract.
 *
 * Qualifying (Review · interval ≥ 1 d · not Manual · first of its day for its card):
 *
 * | # | card | day        | interval | rating | counts as      |
 * |---|------|------------|----------|--------|----------------|
 * | 1 | I    | 2025-12-01 | 100 d    | Good   | mature ✓       |
 * | 2 | H    | 2026-05-20 |  60 d    | Again  | mature ✗       |
 * | 3 | G    | 2026-06-12 |  10 d    | Good   | young ✓        |
 * | 4 | A    | 2026-06-12 |   8 d    | Again  | young ✗        |
 * | 5 | A    | 2026-06-15 |   5 d    | Good   | young ✓        |
 * | 6 | B    | 2026-06-15 |  30 d    | Again  | mature ✗       |
 * | 7 | E    | 2026-06-15 |  25 d    | Hard   | mature ✓ (Hard is a recall) |
 *
 * Thrown away: C (Learning — never predicted to be recalled), D (same-day interval),
 * A's second answer of 2026-06-15 (not the first of the day), F (rating Manual).
 */
const EVENTS: readonly ReviewEvent[] = [
  event({ card: 'I', at: '2025-12-01T10:00:00Z', scheduledDays: 100, rating: 3, level: 'normal' }),
  event({
    card: 'H',
    at: '2026-05-20T10:00:00Z',
    scheduledDays: 60,
    rating: 1,
    level: 'maintenance',
  }),
  event({ card: 'G', at: '2026-06-12T10:00:00Z', scheduledDays: 10, rating: 3, level: 'normal' }),
  event({ card: 'A', at: '2026-06-12T11:00:00Z', scheduledDays: 8, rating: 1, level: 'normal' }),
  event({ card: 'A', at: '2026-06-15T08:00:00Z', scheduledDays: 5, rating: 3, level: 'normal' }),
  event({ card: 'B', at: '2026-06-15T08:30:00Z', scheduledDays: 30, rating: 1, level: 'high' }),
  // Learning: being taught, not tested.
  event({
    card: 'C',
    at: '2026-06-15T08:40:00Z',
    state: CARD_STATE.Learning,
    scheduledDays: 0,
    rating: 3,
  }),
  // A same-day step is not a retention test.
  event({ card: 'D', at: '2026-06-15T08:50:00Z', scheduledDays: 0, rating: 3 }),
  // A's second answer of the day: the relearning step, not evidence about the curve.
  event({ card: 'A', at: '2026-06-15T09:00:00Z', scheduledDays: 5, rating: 1, level: 'normal' }),
  event({ card: 'E', at: '2026-06-15T09:10:00Z', scheduledDays: 25, rating: 2, level: 'high' }),
  // Rating 0 is a postpone, not an answer.
  event({ card: 'F', at: '2026-06-15T09:20:00Z', scheduledDays: 3, rating: 0 }),
]

function card(overrides: Partial<CardMemoryState> & { cardId: string }): CardMemoryState {
  return {
    level: 'normal',
    state: CARD_STATE.Review,
    stability: 10,
    difficulty: 5,
    due: NOW,
    lastReview: NOW,
    ...overrides,
  }
}

function repository(
  events: readonly ReviewEvent[] = EVENTS,
  cards: readonly CardMemoryState[] = [],
): StatsRepository {
  return {
    listReviewEvents: async (from: Date, to: Date, _options?: StatsReadOptions) =>
      events.filter(
        (candidate) =>
          candidate.review.getTime() >= from.getTime() && candidate.review.getTime() < to.getTime(),
      ),
    listMemoryStates: async () => [...cards],
  }
}

const queries = (
  events?: readonly ReviewEvent[],
  cards?: readonly CardMemoryState[],
  extra: Partial<Parameters<typeof createStatsQueries>[0]> = {},
) => createStatsQueries({ repos: repository(events, cards), dayBoundary: BOUNDARY, ...extra })

describe('true retention — hand-computed windows', () => {
  /**
   * day    · young A✓            → 1/1 ; mature B✗ E✓        → 1/2 ; all 2/3
   * week   · young G✓ A✗ A✓      → 2/3 ; mature B✗ E✓        → 1/2 ; all 3/5
   * month  · young G✓ A✗ A✓      → 2/3 ; mature H✗ B✗ E✓     → 1/3 ; all 3/6
   * year   · young G✓ A✗ A✓      → 2/3 ; mature I✓ H✗ B✗ E✓  → 2/4 ; all 4/7
   */
  const expected = {
    day: { young: [1, 1], mature: [1, 2], all: [2, 3] },
    week: { young: [2, 3], mature: [1, 2], all: [3, 5] },
    month: { young: [2, 3], mature: [1, 3], all: [3, 6] },
    year: { young: [2, 3], mature: [2, 4], all: [4, 7] },
  } as const

  it.each(Object.keys(expected) as (keyof typeof expected)[])(
    'the %s window matches the fixture counted by hand',
    async (window) => {
      const result = await queries().trueRetention(window, NOW)
      for (const bucket of ['young', 'mature', 'all'] as const) {
        const [correct, reviewed] = expected[window][bucket]
        expect(result[bucket].correct, `${window}.${bucket}.correct`).toBe(correct)
        expect(result[bucket].reviewed, `${window}.${bucket}.reviewed`).toBe(reviewed)
        expect(result[bucket].retention as number).toBeCloseTo(correct / reviewed, 12)
      }
    },
  )

  it('answers the overview over the month window, from the same read as everything else', async () => {
    const overview = await queries().overview({ now: NOW })
    const [correct, reviewed] = expected.month.all
    expect(overview.trueRetention).toMatchObject({ window: 'month', from: '2026-05-17' })
    expect(overview.trueRetention.all).toMatchObject({ correct, reviewed })
  })

  it('does not read a year of history to draw a page that shows a month', async () => {
    const spans: number[] = []
    const repos = repository()
    const spy = createStatsQueries({
      repos: {
        listReviewEvents: async (from, to, options) => {
          spans.push(Math.round((to.getTime() - from.getTime()) / DAY_MS))
          return repos.listReviewEvents(from, to, options)
        },
        listMemoryStates: repos.listMemoryStates,
      },
      dayBoundary: BOUNDARY,
    })

    await spy.overview({ now: NOW, memorizedDays: 30 })
    expect(spans).toHaveLength(1)
    expect(spans[0] as number).toBeLessThanOrEqual(31)

    // The year window is still available — it just costs a read of its own, when asked.
    await spy.trueRetention('year', NOW)
    expect(spans[1] as number).toBeGreaterThan(360)
  })

  it('has no retention rather than 0 % when nothing qualified', async () => {
    const result = await queries([]).trueRetention('day', NOW)
    expect(result.all).toEqual({ reviewed: 0, correct: 0, retention: null })
  })

  it('counts Hard as a recall and Again as the only failure', async () => {
    const only = [
      event({ card: 'x', at: '2026-06-15T08:00:00Z', scheduledDays: 5, rating: 2 }),
      event({ card: 'y', at: '2026-06-15T08:00:00Z', scheduledDays: 5, rating: 4 }),
      event({ card: 'z', at: '2026-06-15T08:00:00Z', scheduledDays: 5, rating: 1 }),
    ]
    const result = await queries(only).trueRetention('day', NOW)
    expect(result.all).toMatchObject({ reviewed: 3, correct: 2 })
  })

  it.each(['cram', 'import'] as const)(
    'leaves %s reviews out — they are not evidence about this scheduler',
    async (context) => {
      const only = [
        {
          ...event({ card: 'x', at: '2026-06-15T08:00:00Z', scheduledDays: 5, rating: 3 }),
          context,
        },
      ]
      expect((await queries(only).trueRetention('day', NOW)).all.reviewed).toBe(0)
    },
  )

  it('keeps a diagnostic review that reached a card already in review', async () => {
    const only = [
      {
        ...event({ card: 'x', at: '2026-06-15T08:00:00Z', scheduledDays: 5, rating: 3 }),
        context: 'diagnostic' as const,
      },
    ]
    expect((await queries(only).trueRetention('day', NOW)).all.reviewed).toBe(1)
  })

  it('draws the young/mature line at 21 days, inclusive at the top', async () => {
    const only = [
      event({ card: 'x', at: '2026-06-15T08:00:00Z', scheduledDays: 20, rating: 3 }),
      event({ card: 'y', at: '2026-06-15T08:00:00Z', scheduledDays: 21, rating: 3 }),
    ]
    const result = await queries(only).trueRetention('day', NOW)
    expect(result.young.reviewed).toBe(1)
    expect(result.mature.reviewed).toBe(1)
  })
})

describe('desired vs true retention per level', () => {
  /**
   * Over the month window, by level:
   *   normal      · G✓ A✗ A✓ → 2/3 ≈ 0.6667 vs DR 0.90 → gap −0.2333 → alert
   *   high        · B✗ E✓    → 1/2 = 0.5    vs DR 0.92 → gap −0.42   → alert
   *   maintenance · H✗       → 0/1 = 0      vs DR 0.85 → gap −0.85   → alert
   *   urgent      · nothing  → null, no gap, no alert
   *   paused      · nothing  → DR is null too
   */
  it('compares each level against its desired retention', async () => {
    const { byLevel, retentionAlert } = await queries().overview({ now: NOW })
    const at = (level: ImportanceLevel) =>
      byLevel.find((entry) => entry.level === level) as (typeof byLevel)[number]

    expect(at('normal').trueRetention as number).toBeCloseTo(2 / 3, 12)
    expect(at('normal').desiredRetention).toBe(0.9)
    expect(at('normal').gap as number).toBeCloseTo(2 / 3 - 0.9, 12)

    expect(at('high')).toMatchObject({ reviewed: 2, desiredRetention: 0.92, alert: true })
    expect(at('high').trueRetention).toBe(0.5)

    expect(at('maintenance')).toMatchObject({ trueRetention: 0, desiredRetention: 0.85 })
    expect(at('urgent')).toMatchObject({ reviewed: 0, trueRetention: null, gap: null })
    expect(at('paused').desiredRetention).toBeNull()
    expect(retentionAlert).toBe(true)
  })

  it('raises no alert inside 5 pp, and one just outside it', async () => {
    // 19 of 20 correct is 0.95 against `high`'s 0.92 — a 3 pp gap.
    const inside = Array.from({ length: 20 }, (_, i) =>
      event({
        card: `c${i}`,
        at: '2026-06-15T08:00:00Z',
        scheduledDays: 5,
        rating: i === 0 ? 1 : 3,
        level: 'high',
      }),
    )
    expect((await queries(inside).overview({ now: NOW })).retentionAlert).toBe(false)

    // 17 of 20 is 0.85 — a 7 pp gap.
    const outside = inside.map((entry, i) => (i < 3 ? { ...entry, rating: 1 as Rating } : entry))
    expect((await queries(outside).overview({ now: NOW })).retentionAlert).toBe(true)
  })
})

describe('memorized knowledge and mean retrievability', () => {
  it('is Σ R over every card, and the mean over the Review ones', async () => {
    // R(S, S) = 0.9 exactly — the definition of stability — so each of these is 0.9.
    const cards = [
      card({
        cardId: 'a',
        stability: 10,
        lastReview: new Date(NOW.getTime() - 10 * DAY_MS),
      }),
      card({
        cardId: 'b',
        stability: 20,
        lastReview: new Date(NOW.getTime() - 20 * DAY_MS),
      }),
      // New: nothing to retrieve, so it adds 0 and is outside the mean.
      card({ cardId: 'c', state: CARD_STATE.New, stability: 0, lastReview: null }),
    ]
    const { memorized } = await queries([], cards).overview({ now: NOW, memorizedDays: 1 })

    expect(memorized.today).toBeCloseTo(1.8, 10)
    expect(memorized.meanRetrievability as number).toBeCloseTo(0.9, 10)
    expect(memorized.reviewCards).toBe(2)
    expect(memorized.totalCards).toBe(3)
  })

  it('has no mean rather than 0 when nothing is in Review yet', async () => {
    const cards = [card({ cardId: 'c', state: CARD_STATE.New, stability: 0, lastReview: null })]
    const { memorized } = await queries([], cards).overview({ now: NOW })
    expect(memorized.meanRetrievability).toBeNull()
    expect(memorized.today).toBe(0)
  })

  it('produces one series point per day, oldest first, ending today', async () => {
    const cards = [
      card({ cardId: 'a', stability: 10, lastReview: new Date(NOW.getTime() - 10 * DAY_MS) }),
    ]
    const { memorized } = await queries([], cards).overview({ now: NOW, memorizedDays: 5 })

    expect(memorized.series).toHaveLength(5)
    expect(memorized.series.map((day) => day.offset)).toEqual([4, 3, 2, 1, 0])
    expect(memorized.series.at(-1)?.day).toBe('2026-06-15')
    expect(memorized.series.at(-1)?.memorized as number).toBeCloseTo(memorized.today, 10)
    // Undisturbed, R only decays, so the series is monotonically falling.
    const values = memorized.series.map((day) => day.memorized)
    for (let i = 1; i < values.length; i++) {
      expect(values[i] as number).toBeLessThan(values[i - 1] as number)
    }
  })

  it('reconstructs the past from the log rather than projecting today backwards', async () => {
    /*
     * One card, reviewed three days ago. Before that review its stability was 2 and it had
     * last been seen five days earlier; after it, stability 30, seen three days ago.
     *
     * The series has to read the *old* state for the days before that review. Four days ago
     * the card was 4.67 days into a stability of 2 — the pre-review segment — which the
     * forgetting curve puts at ≈ 0.832. Projecting today's state backwards instead would
     * ask for R at a negative elapsed time and clamp it to a flat 1.0, drawing a graph that
     * never dips. The gap between those two is the whole point of the reconstruction.
     */
    const reviewedAt = new Date(NOW.getTime() - 3 * DAY_MS)
    const previouslySeen = new Date(reviewedAt.getTime() - 5 * DAY_MS)
    const events: ReviewEvent[] = [
      {
        ...event({ card: 'a', at: reviewedAt.toISOString(), scheduledDays: 5, rating: 3 }),
        stability: 2,
        due: previouslySeen,
      },
    ]
    const cards = [card({ cardId: 'a', stability: 30, lastReview: reviewedAt })]

    const { memorized } = await queries(events, cards).overview({ now: NOW, memorizedDays: 6 })
    const byOffset = new Map(memorized.series.map((day) => [day.offset, day.memorized]))

    expect(byOffset.get(0) as number).toBeCloseTo(forgettingCurve(3, 30), 6)

    // Each past day is sampled at its last instant; offset 4 is 2026-06-12T03:59:59.999Z,
    // which is before the review that morning at 12:00.
    const todayStart = studyDayStart(NOW, BOUNDARY.dayStartHour, BOUNDARY.timeZone)
    const sampleAt = todayStart.getTime() - 3 * DAY_MS - 1
    expect(sampleAt).toBeLessThan(reviewedAt.getTime())
    const elapsed = (sampleAt - previouslySeen.getTime()) / DAY_MS

    const fourDaysAgo = byOffset.get(4) as number
    expect(fourDaysAgo).toBeCloseTo(forgettingCurve(elapsed, 2), 10)
    // Strictly below the flat 1.0 a backwards projection of today's state would produce.
    expect(fourDaysAgo).toBeLessThan(1)
    // The review lifted it: two days ago, on the new stability, R is higher than before it.
    expect(byOffset.get(2) as number).toBeGreaterThan(fourDaysAgo)
  })
})

describe('stability and difficulty distributions', () => {
  it('bins S and D and reports §13’s two headline shares', async () => {
    const cards = [
      card({ cardId: '1', stability: 0.5, difficulty: 1 }),
      card({ cardId: '2', stability: 3, difficulty: 2.4 }),
      card({ cardId: '3', stability: 30, difficulty: 5 }),
      card({ cardId: '4', stability: 400, difficulty: 9.9 }),
      // New cards are not part of a memory histogram.
      card({ cardId: '5', state: CARD_STATE.New, stability: 0, difficulty: 0 }),
    ]
    const { distribution } = await queries([], cards).overview({ now: NOW })

    expect(distribution.cards).toBe(4)
    expect(distribution.stability.map((bin) => bin.count)).toEqual([1, 1, 0, 1, 0, 1])
    // S > 21 d: the 30 d and 400 d cards. S > 365 d: only the 400 d one.
    expect(distribution.shareOver21Days).toBe(0.5)
    expect(distribution.shareOver365Days).toBe(0.25)
    expect(distribution.meanStability as number).toBeCloseTo((0.5 + 3 + 30 + 400) / 4, 10)

    // D 1 → bin 1, D 2.4 → bin 2, D 5 → bin 5, D 9.9 → bin 9.
    const byLabel = new Map(distribution.difficulty.map((bin) => [bin.label, bin.count]))
    expect([...byLabel.entries()].filter(([, count]) => count > 0)).toEqual([
      ['1', 1],
      ['2', 1],
      ['5', 1],
      ['9', 1],
    ])
  })

  it('still returns every bin when there is nothing to plot', async () => {
    const { distribution } = await queries([], []).overview({ now: NOW })
    expect(distribution.cards).toBe(0)
    expect(distribution.stability).toHaveLength(6)
    expect(distribution.difficulty).toHaveLength(10)
    expect(distribution.meanStability).toBeNull()
  })
})

describe('forecast', () => {
  it('reuses sub-phase 4.3’s query rather than reimplementing it', async () => {
    const stub = {
      days: [],
      medianSecondsPerCard: 8,
      backlog: 0,
      newPool: 0,
      dailyNewLimit: 10,
      generatedAt: NOW,
    }
    const calls: number[] = []
    const { forecast } = await queries([], [], {
      forecast: async (days: number) => {
        calls.push(days)
        return stub
      },
    }).overview({ now: NOW, forecastDays: 90 })

    expect(calls).toEqual([90])
    expect(forecast).toBe(stub)
  })

  it('is null when no forecast query was wired in', async () => {
    expect((await queries().overview({ now: NOW })).forecast).toBeNull()
  })
})
