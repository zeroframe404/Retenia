import { createEmptyCard, type Grade as FsrsGrade, fsrs, State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import type { Card } from '../entities'
import { cardFixture } from '../testing/memory-fixtures'
import { forgettingCurve, fuzzRange, intervalForRetention } from './formulas'
import { createFsrsScheduler, FsrsScheduler } from './fsrs-scheduler'
import { fromFsrsCard, toFsrsCard } from './mappers'
import { DEFAULT_FSRS_W, DEFAULT_SCHEDULING_OPTIONS } from './parameters'
import { DAY_MS } from './study-day'
import { GRADES, type Grade, type ReviewLogDraft, type SchedulingOptions } from './types'

const NO_FUZZ: SchedulingOptions = { ...DEFAULT_SCHEDULING_OPTIONS, fuzz: false }
const NOW = new Date('2026-06-01T12:00:00Z')
const BA = 'America/Argentina/Buenos_Aires'

function reviewCard(overrides: Partial<Card> = {}): Card {
  return cardFixture({
    state: 2,
    stability: 12.3,
    difficulty: 5.2,
    scheduledDays: 10,
    reps: 6,
    lapses: 1,
    lastReview: new Date(NOW.getTime() - 10 * DAY_MS),
    due: new Date(NOW.getTime() - DAY_MS),
    ...overrides,
  })
}

/** Reviews `card` a few times with our scheduler, returning the trail. */
function history(
  scheduler: FsrsScheduler,
  card: Card,
  reviews: Array<[offsetMs: number, grade: Grade]>,
  options: SchedulingOptions,
): { cards: Card[]; logs: ReviewLogDraft[] } {
  const cards: Card[] = []
  const logs: ReviewLogDraft[] = []
  let current = card
  for (const [offset, grade] of reviews) {
    const result = scheduler.apply(current, new Date(NOW.getTime() + offset), grade, options)
    cards.push(result.card)
    logs.push(result.log)
    current = result.card
  }
  return { cards, logs }
}

describe('construction', () => {
  it('is the fsrs6 scheduler with the spec defaults', () => {
    const scheduler = createFsrsScheduler()
    expect(scheduler.id).toBe('fsrs6')
    expect(scheduler.w).toEqual(DEFAULT_FSRS_W)
    expect(Object.isFrozen(scheduler.w)).toBe(true)
    expect(scheduler.enableShortTerm).toBe(true)
    expect(scheduler.dayBoundary).toEqual({ dayStartHour: 4, timeZone: 'UTC' })
    expect(scheduler.instanceCount).toBe(0)
    expect(new FsrsScheduler()).toBeInstanceOf(FsrsScheduler)
  })

  it('clamps the parameters it is given and validates the rest', () => {
    const wild = [...DEFAULT_FSRS_W]
    wild[0] = 1000
    wild[20] = 5
    const scheduler = createFsrsScheduler({
      w: wild,
      enableShortTerm: false,
      dayStartHour: 0,
      timeZone: BA,
    })
    expect(scheduler.w[0]).toBe(100)
    expect(scheduler.w[20]).toBe(0.8)
    expect(scheduler.enableShortTerm).toBe(false)
    expect(scheduler.dayBoundary).toEqual({ dayStartHour: 0, timeZone: BA })
    expect(() => createFsrsScheduler({ w: [1, 2, 3] })).toThrow(/21 parameters/)
    expect(() => createFsrsScheduler({ dayStartHour: 25 })).toThrow(RangeError)
    expect(() => createFsrsScheduler({ timeZone: 'Nowhere/Land' })).toThrow(RangeError)
  })
})

describe('memoized ts-fsrs instances', () => {
  it('keeps one instance per distinct options, whatever the object identity', () => {
    const scheduler = createFsrsScheduler()
    scheduler.apply(cardFixture(), NOW, 3, DEFAULT_SCHEDULING_OPTIONS)
    scheduler.apply(cardFixture(), NOW, 3, { ...DEFAULT_SCHEDULING_OPTIONS })
    scheduler.apply(cardFixture(), NOW, 3, NO_FUZZ)
    expect(scheduler.instanceCount).toBe(1)
    scheduler.apply(cardFixture(), NOW, 3, { ...NO_FUZZ, desiredRetention: 0.95 })
    scheduler.apply(cardFixture(), NOW, 3, { ...NO_FUZZ, maxIntervalDays: 180 })
    scheduler.apply(cardFixture(), NOW, 3, { ...NO_FUZZ, learningSteps: ['5m'] })
    scheduler.apply(cardFixture(), NOW, 3, { ...NO_FUZZ, relearningSteps: [] })
    expect(scheduler.instanceCount).toBe(5)
  })

  it('bounds the cache when an exam ramps its retention day after day', () => {
    const scheduler = createFsrsScheduler()
    for (let i = 0; i < 80; i++) {
      scheduler.apply(cardFixture(), NOW, 3, { ...NO_FUZZ, desiredRetention: 0.7 + i * 0.003 })
    }
    expect(scheduler.instanceCount).toBe(64)
    // The evicted (oldest) options still work: they are simply rebuilt.
    const again = scheduler.apply(cardFixture(), NOW, 3, { ...NO_FUZZ, desiredRetention: 0.7 })
    expect(again.card.state).toBe(1)
  })

  it('rejects options ts-fsrs would misread, before touching the card', () => {
    const scheduler = createFsrsScheduler()
    expect(() =>
      scheduler.apply(cardFixture(), NOW, 3, { ...NO_FUZZ, desiredRetention: 0 }),
    ).toThrow(/desiredRetention/)
    expect(() => scheduler.preview(cardFixture(), NOW, { ...NO_FUZZ, maxIntervalDays: 0 })).toThrow(
      /maxIntervalDays/,
    )
  })
})

describe('apply — parity with ts-fsrs', () => {
  const scheduler = createFsrsScheduler({ dayStartHour: 0 })
  const reference = fsrs({ w: [...DEFAULT_FSRS_W], enable_fuzz: false })

  const cards: Card[] = [
    cardFixture(),
    cardFixture({
      state: 1,
      stability: 2.3,
      difficulty: 4.9,
      learningSteps: 1,
      reps: 1,
      lastReview: new Date(NOW.getTime() - 600_000),
      due: new Date(NOW.getTime() - 60_000),
    }),
    reviewCard(),
    reviewCard({ stability: 0.8, difficulty: 8, lastReview: new Date(NOW.getTime() - 3 * DAY_MS) }),
    cardFixture({
      state: 3,
      stability: 1.1,
      difficulty: 7.7,
      reps: 9,
      lapses: 3,
      lastReview: new Date(NOW.getTime() - 900_000),
      due: new Date(NOW.getTime() - 300_000),
    }),
    reviewCard({
      lastReview: new Date(NOW.getTime() - 3_600_000),
      due: new Date(NOW.getTime() + 20 * DAY_MS),
    }),
  ]

  it('produces ts-fsrs’s card and log for every state and grade, fuzz off', () => {
    for (const card of cards) {
      for (const grade of GRADES) {
        const ours = scheduler.apply(card, NOW, grade, NO_FUZZ)
        const theirs = reference.next(toFsrsCard(card), NOW, grade as FsrsGrade)
        expect(ours.card).toEqual(fromFsrsCard(theirs.card, card))
        expect(ours.log).toEqual({
          cardId: card.id,
          rating: grade,
          state: theirs.log.state,
          due: theirs.log.due,
          stability: theirs.log.stability,
          difficulty: theirs.log.difficulty,
          elapsedDays: theirs.log.elapsed_days,
          scheduledDays: theirs.log.scheduled_days,
          learningSteps: theirs.log.learning_steps,
          review: NOW,
          algorithmVersion: 'fsrs6',
        })
      }
    }
  })

  it('agrees with ts-fsrs under the default 4 a.m. rollover when no review straddles it', () => {
    const fourAm = createFsrsScheduler()
    const at = new Date('2026-06-01T08:00:00Z')
    for (const card of cards) {
      const shifted = {
        ...card,
        lastReview: card.lastReview && new Date(card.lastReview.getTime() - 4 * 3_600_000),
        due: new Date(card.due.getTime() - 4 * 3_600_000),
      }
      for (const grade of GRADES) {
        const ours = fourAm.apply(shifted, at, grade, NO_FUZZ)
        const theirs = reference.next(toFsrsCard(shifted), at, grade as FsrsGrade)
        expect(ours.card.stability).toBe(theirs.card.stability)
        expect(ours.card.difficulty).toBe(theirs.card.difficulty)
        expect(ours.card.due).toEqual(theirs.card.due)
        expect(ours.card.state).toBe(theirs.card.state)
      }
    }
  })

  it('previews exactly what apply would do, for each button', () => {
    for (const options of [NO_FUZZ, DEFAULT_SCHEDULING_OPTIONS]) {
      for (const card of cards) {
        const preview = scheduler.preview(card, NOW, options)
        for (const grade of GRADES) {
          expect(preview[grade]).toEqual(scheduler.apply(card, NOW, grade, options))
        }
      }
    }
  })

  it('takes a New card through the learning steps into Review', () => {
    const start = cardFixture({ due: NOW })
    const first = scheduler.apply(start, NOW, 3, NO_FUZZ)
    expect(first.card).toMatchObject({
      state: 1,
      learningSteps: 1,
      reps: 1,
      lapses: 0,
      scheduledDays: 0,
    })
    expect(first.card.due.getTime() - NOW.getTime()).toBe(10 * 60_000)
    expect(first.card.lastReview).toEqual(NOW)
    expect(first.log).toMatchObject({
      state: 0,
      due: NOW,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
    })

    const later = new Date(NOW.getTime() + 10 * 60_000)
    const second = scheduler.apply(first.card, later, 3, NO_FUZZ)
    expect(second.card.state).toBe(2)
    expect(second.card.learningSteps).toBe(0)
    expect(second.card.scheduledDays).toBeGreaterThanOrEqual(1)
    expect(second.card.due.getTime() - later.getTime()).toBe(second.card.scheduledDays * DAY_MS)
    expect(second.log.elapsedDays).toBe(0)
    // ts-fsrs's convention: the log's `due` is the previous last review.
    expect(second.log.due).toEqual(NOW)

    const easy = scheduler.apply(start, NOW, 4, NO_FUZZ)
    expect(easy.card.state).toBe(2)
    expect(easy.card.scheduledDays).toBe(8)
  })

  it('sends a lapsed Review card to Relearning and counts the lapse', () => {
    const result = scheduler.apply(reviewCard(), NOW, 1, NO_FUZZ)
    expect(result.card).toMatchObject({
      state: 3,
      lapses: 2,
      reps: 7,
      learningSteps: 0,
      scheduledDays: 0,
    })
    expect(result.card.due.getTime() - NOW.getTime()).toBe(10 * 60_000)
    expect(result.card.stability).toBeLessThan(12.3)
    const noSteps = scheduler.apply(reviewCard(), NOW, 1, { ...NO_FUZZ, relearningSteps: [] })
    expect(noSteps.card.state).toBe(2)
    expect(noSteps.card.scheduledDays).toBeGreaterThanOrEqual(1)
  })

  it('validates the card and the review time', () => {
    expect(() => scheduler.apply(cardFixture({ state: 5 as never }), NOW, 3, NO_FUZZ)).toThrow(
      /state/,
    )
    expect(() => scheduler.apply(cardFixture(), new Date(Number.NaN), 3, NO_FUZZ)).toThrow(
      TypeError,
    )
    expect(() =>
      scheduler.apply(cardFixture({ due: new Date(Number.NaN) }), NOW, 3, NO_FUZZ),
    ).toThrow(TypeError)
    expect(() => scheduler.apply(cardFixture(), '2026-06-01' as never, 3, NO_FUZZ)).toThrow(
      TypeError,
    )
    expect(() =>
      scheduler.apply(reviewCard({ lastReview: new Date('x') }), NOW, 3, NO_FUZZ),
    ).toThrow(TypeError)
    expect(() => scheduler.apply(cardFixture(), NOW, 0 as never, NO_FUZZ)).toThrow(/grade/)
    expect(() => scheduler.apply(cardFixture(), NOW, 5 as never, NO_FUZZ)).toThrow(/grade/)
  })
})

describe('day boundaries', () => {
  const card = reviewCard({
    lastReview: new Date('2026-01-04T22:00:00Z'),
    due: new Date('2026-01-14T22:00:00Z'),
  })
  const at = new Date('2026-01-05T03:00:00Z')

  it('treats a 3 a.m. review as the same study day as the evening before (4 a.m. rollover)', () => {
    const sameDay = createFsrsScheduler().apply(card, at, 3, NO_FUZZ)
    const nextDay = createFsrsScheduler({ dayStartHour: 0 }).apply(card, at, 3, NO_FUZZ)
    expect(sameDay.log.elapsedDays).toBe(0)
    expect(nextDay.log.elapsedDays).toBe(1)
    // Same day → the short-term formula; next day → the recall formula. They differ.
    expect(sameDay.card.stability).not.toBe(nextDay.card.stability)
    // Which the closed forms confirm.
    const reference = fsrs({ w: [...DEFAULT_FSRS_W], enable_fuzz: false })
    expect(sameDay.card.stability).toBe(
      reference.next_state({ stability: 12.3, difficulty: 5.2 }, 0, 3).stability,
    )
    expect(nextDay.card.stability).toBe(
      reference.next_state({ stability: 12.3, difficulty: 5.2 }, 1, 3).stability,
    )
    // Either way the booked interval is measured from the real review instant.
    expect(sameDay.card.due.getTime() - at.getTime()).toBe(sameDay.card.scheduledDays * DAY_MS)
    expect(sameDay.card.lastReview).toEqual(at)
  })

  it('uses the user’s zone: 3 a.m. in Buenos Aires is 06:00 UTC', () => {
    const local = createFsrsScheduler({ timeZone: BA })
    const utc = createFsrsScheduler()
    const evening = reviewCard({
      lastReview: new Date('2026-01-05T01:00:00Z'),
      due: new Date('2026-01-15T01:00:00Z'),
    })
    const smallHours = new Date('2026-01-05T06:30:00Z')
    expect(local.apply(evening, smallHours, 3, NO_FUZZ).log.elapsedDays).toBe(0)
    expect(utc.apply(evening, smallHours, 3, NO_FUZZ).log.elapsedDays).toBe(1)
    expect(local.retrievability(evening, smallHours)).toBe(1)
    expect(utc.retrievability(evening, smallHours)).toBeLessThan(1)
  })

  it('logs a negative elapsed time when the clock stepped back, scheduling as same-day', () => {
    const scheduler = createFsrsScheduler()
    const future = reviewCard({ lastReview: new Date(NOW.getTime() + 2 * DAY_MS) })
    const result = scheduler.apply(future, NOW, 3, NO_FUZZ)
    expect(result.log.elapsedDays).toBe(-2)
    expect(scheduler.elapsedDays(future, NOW)).toBe(-2)
    const sameDay = scheduler.apply(reviewCard({ lastReview: NOW }), NOW, 3, NO_FUZZ)
    expect(result.card.stability).toBe(sameDay.card.stability)
    expect(result.card.lastReview).toEqual(NOW)
    expect(scheduler.elapsedDays(cardFixture(), NOW)).toBe(0)
  })
})

describe('fuzz', () => {
  const scheduler = createFsrsScheduler()

  it('keeps day intervals inside the fuzz window and is reproducible per card and review', () => {
    for (const card of [reviewCard(), reviewCard({ id: '019a0000-0000-7000-8000-000000000002' })]) {
      const plain = scheduler.apply(card, NOW, 3, NO_FUZZ)
      const fuzzed = scheduler.apply(card, NOW, 3, DEFAULT_SCHEDULING_OPTIONS)
      const window = fuzzRange(plain.card.scheduledDays, 10, 36500)
      expect(fuzzed.card.scheduledDays).toBeGreaterThanOrEqual(window.min)
      expect(fuzzed.card.scheduledDays).toBeLessThanOrEqual(window.max)
      expect(fuzzed.card.due.getTime() - NOW.getTime()).toBe(fuzzed.card.scheduledDays * DAY_MS)
      expect(scheduler.apply(card, NOW, 3, DEFAULT_SCHEDULING_OPTIONS)).toEqual(fuzzed)
      // Everything but the calendar is untouched by fuzz.
      expect(fuzzed.card.stability).toBe(plain.card.stability)
      expect(fuzzed.card.difficulty).toBe(plain.card.difficulty)
      expect(fuzzed.log).toEqual(plain.log)
    }
  })

  it('spreads cards created together: different ids, different days', () => {
    const days = new Set<number>()
    for (let i = 0; i < 24; i++) {
      const card = reviewCard({
        id: `019a0000-0000-7000-8000-${String(i).padStart(12, '0')}`,
        stability: 60,
        scheduledDays: 60,
        lastReview: new Date(NOW.getTime() - 60 * DAY_MS),
      })
      days.add(scheduler.apply(card, NOW, 3, DEFAULT_SCHEDULING_OPTIONS).card.scheduledDays)
    }
    expect(days.size).toBeGreaterThan(1)
    // And the same card fuzzes differently from one review to the next.
    const card = reviewCard({
      stability: 60,
      scheduledDays: 60,
      lastReview: new Date(NOW.getTime() - 60 * DAY_MS),
    })
    const perReps = new Set<number>()
    for (let reps = 0; reps < 24; reps++) {
      perReps.add(
        scheduler.apply({ ...card, reps }, NOW, 3, DEFAULT_SCHEDULING_OPTIONS).card.scheduledDays,
      )
    }
    expect(perReps.size).toBeGreaterThan(1)
  })

  it('leaves learning steps and short intervals alone', () => {
    const learning = scheduler.apply(cardFixture(), NOW, 3, DEFAULT_SCHEDULING_OPTIONS)
    expect(learning.card.due.getTime() - NOW.getTime()).toBe(10 * 60_000)
    // A relearning card and a card whose interval is under 2.5 days.
    const lapse = scheduler.apply(reviewCard(), NOW, 1, DEFAULT_SCHEDULING_OPTIONS)
    expect(lapse.card.due.getTime() - NOW.getTime()).toBe(10 * 60_000)
    const short = reviewCard({
      stability: 0.5,
      scheduledDays: 1,
      lastReview: new Date(NOW.getTime() - DAY_MS),
    })
    const plain = scheduler.apply(short, NOW, 2, NO_FUZZ)
    expect(plain.card.scheduledDays).toBeLessThan(2.5)
    expect(scheduler.apply(short, NOW, 2, DEFAULT_SCHEDULING_OPTIONS).card.scheduledDays).toBe(
      plain.card.scheduledDays,
    )
  })

  it('keeps Hard < Good < Easy after fuzzing a reviewed card', () => {
    for (const stability of [1, 3, 12.3, 60, 400]) {
      for (let i = 0; i < 8; i++) {
        const card = reviewCard({
          id: `019a0000-0000-7000-8000-${String(i).padStart(12, '0')}`,
          stability,
          lastReview: new Date(NOW.getTime() - Math.ceil(stability) * DAY_MS),
        })
        const preview = scheduler.preview(card, NOW, DEFAULT_SCHEDULING_OPTIONS)
        expect(preview[2].card.scheduledDays).toBeLessThan(preview[3].card.scheduledDays)
        expect(preview[3].card.scheduledDays).toBeLessThan(preview[4].card.scheduledDays)
      }
    }
  })

  it('fuzzes a card graduating straight to Review too', () => {
    // New + Easy: S0 = 8.2956 → 8 days → window [6, 10].
    const seen = new Set<number>()
    for (let i = 0; i < 24; i++) {
      const card = cardFixture({ id: `019a0000-0000-7000-8000-${String(i).padStart(12, '0')}` })
      const days = scheduler.apply(card, NOW, 4, DEFAULT_SCHEDULING_OPTIONS).card.scheduledDays
      expect(days).toBeGreaterThanOrEqual(6)
      expect(days).toBeLessThanOrEqual(10)
      seen.add(days)
    }
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('load balancing and easy days (§15)', () => {
  const scheduler = createFsrsScheduler()
  // Monday 2026-06-01 + Easy on a New card: 8 days → candidates 6…10 = Sun…Thu.
  const newCard = cardFixture()

  it('hands the balancer every day of the window and books its choice', () => {
    let seen: Date[] = []
    const result = scheduler.apply(newCard, NOW, 4, {
      ...NO_FUZZ,
      loadBalance: (candidates) => {
        seen = candidates
        return candidates[candidates.length - 1] as Date
      },
    })
    expect(seen.map((date) => (date.getTime() - NOW.getTime()) / DAY_MS)).toEqual([6, 7, 8, 9, 10])
    expect(result.card.scheduledDays).toBe(10)
    expect(result.card.due).toEqual(new Date(NOW.getTime() + 10 * DAY_MS))
  })

  it('falls back to the seeded pick when the balancer answers with a day outside the window', () => {
    const fuzzed = scheduler.apply(newCard, NOW, 4, DEFAULT_SCHEDULING_OPTIONS)
    const outside = scheduler.apply(newCard, NOW, 4, {
      ...DEFAULT_SCHEDULING_OPTIONS,
      loadBalance: () => new Date(0),
    })
    const nothing = scheduler.apply(newCard, NOW, 4, {
      ...DEFAULT_SCHEDULING_OPTIONS,
      loadBalance: () => undefined as never,
    })
    expect(outside.card.scheduledDays).toBe(fuzzed.card.scheduledDays)
    expect(nothing.card.scheduledDays).toBe(fuzzed.card.scheduledDays)
    // With fuzz off there is nothing to draw: the booked interval stays.
    const plain = scheduler.apply(newCard, NOW, 4, { ...NO_FUZZ, loadBalance: () => new Date(0) })
    expect(plain.card.scheduledDays).toBe(8)
  })

  it('avoids the user’s minimum days, prefers normal over reduced, and gives up gracefully', () => {
    const thursdayOnly = scheduler.apply(newCard, NOW, 4, {
      ...NO_FUZZ,
      easyDays: { 0: 'minimum', 1: 'minimum', 2: 'minimum', 3: 'minimum' },
    })
    expect(thursdayOnly.card.scheduledDays).toBe(10)
    const reducedThursday = scheduler.apply(newCard, NOW, 4, {
      ...NO_FUZZ,
      easyDays: { 0: 'minimum', 1: 'minimum', 2: 'minimum', 3: 'minimum', 4: 'reduced' },
    })
    expect(reducedThursday.card.scheduledDays).toBe(10)
    const normalWednesday = scheduler.apply(newCard, NOW, 4, {
      ...NO_FUZZ,
      easyDays: { 0: 'minimum', 1: 'reduced', 2: 'reduced', 4: 'reduced' },
    })
    expect(normalWednesday.card.scheduledDays).toBe(9)
    // Nothing better available and fuzz off: the interval ts-fsrs booked stays.
    const everythingMinimum = scheduler.apply(newCard, NOW, 4, {
      ...NO_FUZZ,
      easyDays: { 0: 'minimum', 1: 'minimum', 2: 'minimum', 3: 'minimum', 4: 'minimum' },
    })
    expect(everythingMinimum.card.scheduledDays).toBe(8)
    // Fuzz off: the nearest allowed day, not a draw — Monday (7) is one day from 8,
    // Wednesday (9) too; the earlier one wins the tie.
    const tuesdayOff = scheduler.apply(newCard, NOW, 4, { ...NO_FUZZ, easyDays: { 2: 'minimum' } })
    expect(tuesdayOff.card.scheduledDays).toBe(7)
    const fridayOff = scheduler.apply(newCard, NOW, 4, { ...NO_FUZZ, easyDays: { 5: 'minimum' } })
    expect(fridayOff.card.scheduledDays).toBe(8)
    // Fuzz on: a seeded draw among the allowed days.
    const drawn = scheduler.apply(newCard, NOW, 4, {
      ...DEFAULT_SCHEDULING_OPTIONS,
      easyDays: { 0: 'minimum', 4: 'minimum' },
    })
    expect([7, 8, 9]).toContain(drawn.card.scheduledDays)
    expect(
      scheduler.apply(newCard, NOW, 4, {
        ...DEFAULT_SCHEDULING_OPTIONS,
        easyDays: { 0: 'minimum', 4: 'minimum' },
      }),
    ).toEqual(drawn)
    // The balancer only ever sees the days easy days left over.
    let seen: Date[] = []
    scheduler.apply(newCard, NOW, 4, {
      ...NO_FUZZ,
      easyDays: { 0: 'minimum', 4: 'minimum' },
      loadBalance: (candidates) => {
        seen = candidates
        return candidates[0] as Date
      },
    })
    expect(seen.map((date) => (date.getTime() - NOW.getTime()) / DAY_MS)).toEqual([7, 8, 9])
  })

  /**
   * §4's "and specific dates".
   *
   * `NOW` is Monday 1 June 2026, so the window [6, 10] is Sunday the 7th through Thursday
   * the 11th, and the default 4 a.m. boundary puts a noon review squarely inside its own
   * day.
   */
  it('honours specific dates, which beat the weekday they fall on', () => {
    const off = (day: number) => `2026-06-0${day}`

    // Every day of the window except Wednesday the 10th is out.
    const onlyWednesday = scheduler.apply(newCard, NOW, 4, {
      ...NO_FUZZ,
      easyDates: {
        [off(7)]: 'minimum',
        [off(8)]: 'minimum',
        [off(9)]: 'minimum',
        '2026-06-11': 'minimum',
      },
    })
    expect(onlyWednesday.card.scheduledDays).toBe(9)

    // A date beats its weekday. Every weekday in the window is 'minimum' except Monday,
    // which is 'reduced' — so on weekdays alone the 8th (Monday) wins…
    const weekdaysOnly = scheduler.apply(newCard, NOW, 4, {
      ...NO_FUZZ,
      easyDays: { 0: 'minimum', 1: 'reduced', 2: 'minimum', 3: 'minimum', 4: 'minimum' },
    })
    expect(weekdaysOnly.card.scheduledDays).toBe(7)

    // …and marking Wednesday the 10th 'normal' by date overrides its 'minimum' weekday and
    // takes the booking, because a normal day beats a reduced one.
    const dateWins = scheduler.apply(newCard, NOW, 4, {
      ...NO_FUZZ,
      easyDays: { 0: 'minimum', 1: 'reduced', 2: 'minimum', 3: 'minimum', 4: 'minimum' },
      easyDates: { '2026-06-10': 'normal' },
    })
    expect(dateWins.card.scheduledDays).toBe(9)
  })

  /**
   * The guard this pins is easy to get wrong: both `finalize` and `pickDay` used to test
   * `easyDays` alone, so an options object carrying only `easyDates` — "I am away on the
   * 9th", no weekday preferences at all — skipped the window pass entirely and the date was
   * silently ignored.
   */
  it('applies a dates-only configuration, with no weekday map at all', () => {
    const plain = scheduler.apply(newCard, NOW, 4, NO_FUZZ)
    expect(plain.card.scheduledDays).toBe(8)

    const datesOnly = scheduler.apply(newCard, NOW, 4, {
      ...NO_FUZZ,
      easyDates: { '2026-06-09': 'minimum' },
    })
    expect(datesOnly.card.scheduledDays).not.toBe(8)
    // Fuzz off: the nearest allowed day to 8, and the earlier one wins the tie.
    expect(datesOnly.card.scheduledDays).toBe(7)
  })

  it('gives up gracefully when every day of the window is an excluded date', () => {
    const allOut = scheduler.apply(newCard, NOW, 4, {
      ...NO_FUZZ,
      easyDates: {
        '2026-06-07': 'minimum',
        '2026-06-08': 'minimum',
        '2026-06-09': 'minimum',
        '2026-06-10': 'minimum',
        '2026-06-11': 'minimum',
      },
    })
    expect(allOut.card.scheduledDays).toBe(8)
  })
})

describe('retrievability and intervalFor', () => {
  const scheduler = createFsrsScheduler()

  it('is 0 for a card never reviewed, 1 on the day of the review, 0.9 after S days', () => {
    expect(scheduler.retrievability(cardFixture(), NOW)).toBe(0)
    expect(scheduler.retrievability(reviewCard({ lastReview: null }), NOW)).toBe(0)
    expect(scheduler.retrievability(reviewCard({ stability: 0 }), NOW)).toBe(0)
    const card = reviewCard({ stability: 20, lastReview: NOW })
    expect(scheduler.retrievability(card, NOW)).toBe(1)
    expect(scheduler.retrievability(card, new Date(NOW.getTime() - DAY_MS))).toBe(1)
    expect(scheduler.retrievability(card, new Date(NOW.getTime() + 20 * DAY_MS))).toBeCloseTo(
      0.9,
      12,
    )
    expect(scheduler.retrievability(card, new Date(NOW.getTime() + 5 * DAY_MS))).toBe(
      forgettingCurve(5, 20),
    )
    expect(() => scheduler.retrievability(card, new Date(Number.NaN))).toThrow(TypeError)
  })

  it('agrees with ts-fsrs get_retrievability at whole days', () => {
    const reference = fsrs({ w: [...DEFAULT_FSRS_W] })
    const card = reviewCard({ stability: 7.5, lastReview: new Date(NOW.getTime() - 3 * DAY_MS) })
    expect(scheduler.retrievability(card, NOW)).toBeCloseTo(
      reference.get_retrievability(toFsrsCard(card), NOW, false),
      6,
    )
  })

  it('gives the closed-form interval, exactly S at 0.9', () => {
    expect(scheduler.intervalFor(0.9, { stability: 42 })).toBe(42)
    expect(scheduler.intervalFor(0.95, { stability: 42 })).toBe(intervalForRetention(0.95, 42))
    const custom = [...DEFAULT_FSRS_W]
    custom[20] = 0.3
    expect(createFsrsScheduler({ w: custom }).intervalFor(0.8, { stability: 10 })).toBe(
      intervalForRetention(0.8, 10, 0.3),
    )
  })
})

describe('reschedule', () => {
  const scheduler = createFsrsScheduler()
  const reviews: Array<[number, Grade]> = [
    [0, 3],
    [10 * 60_000, 3],
    [3 * DAY_MS, 2],
    [8 * DAY_MS, 1],
    [8 * DAY_MS + 15 * 60_000, 3],
    [20 * DAY_MS, 4],
  ]

  it('replays the history to the same card, fuzz included, whatever the order of the entries', () => {
    for (const options of [NO_FUZZ, DEFAULT_SCHEDULING_OPTIONS]) {
      const start = cardFixture({ due: NOW })
      const { cards, logs } = history(scheduler, start, reviews, options)
      const final = cards[cards.length - 1] as Card
      expect(scheduler.reschedule(final, logs, options)).toEqual(final)
      expect(scheduler.reschedule(final, [...logs].reverse(), options)).toEqual(final)
      // Rescheduling with other options changes the calendar and the memory state.
      const stricter = scheduler.reschedule(final, logs, { ...options, desiredRetention: 0.95 })
      expect(stricter.due.getTime()).toBeLessThan(final.due.getTime())
      expect(stricter.reps).toBe(final.reps)
    }
  })

  it('skips manual entries and leaves a card without history alone', () => {
    const start = cardFixture({ due: NOW })
    const { cards, logs } = history(scheduler, start, reviews, NO_FUZZ)
    const final = cards[cards.length - 1] as Card
    const postponed = scheduler.postpone(
      final,
      new Date(NOW.getTime() + 21 * DAY_MS),
      new Date(NOW.getTime() + 40 * DAY_MS),
    )
    expect(scheduler.reschedule(postponed.card, [...logs, postponed.log], NO_FUZZ)).toEqual({
      ...final,
      scheduledDays: final.scheduledDays,
    })
    expect(scheduler.reschedule(final, [], NO_FUZZ)).toBe(final)
    expect(scheduler.reschedule(final, [postponed.log], NO_FUZZ)).toBe(final)
    expect(() =>
      scheduler.reschedule(final, [{ rating: 5 as never, review: NOW }], NO_FUZZ),
    ).toThrow(/grade/)
  })
})

describe('rollback', () => {
  const scheduler = createFsrsScheduler()

  it('restores a New card exactly', () => {
    const start = cardFixture({ due: NOW })
    const result = scheduler.apply(start, NOW, 3, NO_FUZZ)
    expect(scheduler.rollback(result.card, result.log)).toEqual(start)
  })

  it('restores memory state, counters and the previous last review of a reviewed card', () => {
    const before = reviewCard()
    for (const grade of GRADES) {
      const result = scheduler.apply(before, NOW, grade, NO_FUZZ)
      const restored = scheduler.rollback(result.card, result.log)
      expect(restored).toMatchObject({
        stability: before.stability,
        difficulty: before.difficulty,
        state: before.state,
        learningSteps: before.learningSteps,
        scheduledDays: before.scheduledDays,
        reps: before.reps,
        lapses: before.lapses,
        lastReview: before.lastReview,
      })
      // ts-fsrs cannot know the previous due date of a reviewed card; it books the
      // review instant, which is at or after the old due date.
      expect(restored.due).toEqual(NOW)
    }
  })

  it('refuses a manual entry', () => {
    const card = reviewCard()
    const { log } = scheduler.postpone(card, NOW, new Date(NOW.getTime() + DAY_MS))
    expect(() => scheduler.rollback(card, log)).toThrow(/manual/)
    expect(() => scheduler.rollback(cardFixture({ state: 9 as never }), log)).toThrow(/state/)
  })
})

describe('forget', () => {
  const scheduler = createFsrsScheduler()

  it('returns the card to New, keeping or resetting the counters, and logs a manual entry', () => {
    const before = reviewCard()
    const kept = scheduler.forget(before, NOW, false)
    expect(kept.card).toEqual({
      ...before,
      due: NOW,
      stability: 0,
      difficulty: 0,
      scheduledDays: 0,
      learningSteps: 0,
      state: 0,
    })
    expect(kept.log).toEqual({
      cardId: before.id,
      rating: 0,
      state: 2,
      due: before.due,
      stability: 12.3,
      difficulty: 5.2,
      elapsedDays: 0,
      scheduledDays: 10,
      learningSteps: 0,
      review: NOW,
      algorithmVersion: 'fsrs6',
    })
    const reset = scheduler.forget(before, NOW, true)
    expect(reset.card.reps).toBe(0)
    expect(reset.card.lapses).toBe(0)
    expect(scheduler.retrievability(kept.card, NOW)).toBe(0)
    expect(() => scheduler.forget(before, new Date(Number.NaN), false)).toThrow(TypeError)
  })

  it('schedules a forgotten card like a new one', () => {
    const forgotten = scheduler.forget(reviewCard(), NOW, false).card
    const relearned = scheduler.apply(forgotten, NOW, 3, NO_FUZZ)
    expect(relearned.card).toMatchObject({ state: 1, learningSteps: 1, reps: 7 })
    expect(relearned.log.elapsedDays).toBe(0)
  })
})

describe('postpone', () => {
  const scheduler = createFsrsScheduler()

  it('moves the due date only, and logs it with rating Manual', () => {
    const before = reviewCard()
    const due = new Date(NOW.getTime() + 5 * DAY_MS)
    const result = scheduler.postpone(before, NOW, due)
    expect(result.card).toEqual({ ...before, due, scheduledDays: 5 })
    expect(result.log).toEqual({
      cardId: before.id,
      rating: 0,
      state: 2,
      due: before.lastReview,
      stability: 12.3,
      difficulty: 5.2,
      elapsedDays: 10,
      scheduledDays: 10,
      learningSteps: 0,
      review: NOW,
      algorithmVersion: 'fsrs6',
    })
    expect(result.card.due).not.toBe(due)
  })

  it('can also bring a card forward, and works on a card never reviewed', () => {
    const advanced = scheduler.postpone(reviewCard(), NOW, new Date(NOW.getTime() - 3 * DAY_MS))
    expect(advanced.card.scheduledDays).toBe(0)
    const fresh = cardFixture({ due: new Date(NOW.getTime() + 3 * DAY_MS) })
    const delayed = scheduler.postpone(fresh, NOW, new Date(NOW.getTime() + 9 * DAY_MS))
    expect(delayed.card.scheduledDays).toBe(9)
    expect(delayed.log.due).toEqual(fresh.due)
    expect(delayed.log.elapsedDays).toBe(0)
    expect(() => scheduler.postpone(fresh, NOW, new Date('nope'))).toThrow(TypeError)
  })
})

describe('ts-fsrs itself', () => {
  it('is the 5.4 line, whose Card still carries elapsed_days (dropped in 6.0)', () => {
    const empty = createEmptyCard(NOW)
    expect(empty).toHaveProperty('elapsed_days', 0)
    expect(empty.state).toBe(State.New)
  })
})

describe('throughput', () => {
  it('stays within a small multiple of ts-fsrs itself (best of three)', () => {
    // `performance` is not in the ES2023 lib this package compiles against.
    const clock = (globalThis as unknown as { performance: { now(): number } }).performance
    const scheduler = createFsrsScheduler()
    const card = reviewCard()
    const reference = fsrs({ w: [...DEFAULT_FSRS_W], enable_fuzz: false })
    const raw = toFsrsCard(card)
    const measure = (work: () => void): number => {
      let best = Number.POSITIVE_INFINITY
      for (let trial = 0; trial < 3; trial++) {
        const start = clock.now()
        for (let i = 0; i < 10_000; i++) work()
        best = Math.min(best, clock.now() - start)
      }
      return best
    }
    for (let i = 0; i < 1000; i++) scheduler.apply(card, NOW, 3, DEFAULT_SCHEDULING_OPTIONS)

    // ts-fsrs alone is the floor the wrapper cannot beat. On an idle core it takes ~60 ms
    // and the wrapper ~150 ms; a loaded CI runner or V8's coverage instrumentation slow
    // both, so the budget is relative rather than a wall-clock number that would fail for
    // reasons having nothing to do with the code.
    //
    // The multiple is deliberately loose. What this guards against is an accidental
    // *asymptotic* regression — a cache that stops hitting, a validation that starts
    // running per review, an O(n²) mapper — which shows up as an order of magnitude, not
    // as 3.2× versus 3×. Tightening it past the noise floor of a shared runner only buys
    // red builds: the two runners this repo uses have both produced ratios above 3 on
    // unchanged code, and `fsrs-scheduler.bench.ts` is where real numbers are tracked.
    const baseline = measure(() => reference.next(raw, NOW, 3))
    const ours = measure(() => {
      scheduler.apply(card, NOW, 3, DEFAULT_SCHEDULING_OPTIONS)
    })
    expect(ours).toBeLessThan(Math.max(400, 10 * baseline))
  })
})
