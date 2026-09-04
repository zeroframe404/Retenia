import { describe, expect, it } from 'vitest'
import type { Card } from '../entities'
import { createDomainEventBus } from '../events'
import { fakeClock } from '../testing/in-memory-job-repository'
import {
  createInMemoryReviewStore,
  type InMemoryReviewStore,
} from '../testing/in-memory-review-store'
import { cardFixture, knowledgeItemFixture } from '../testing/memory-fixtures'
import { createFsrsScheduler } from './fsrs-scheduler'
import type { GradeResult, ReviewSpec } from './rating'
import { createReviewActivity } from './review-activity'
import { createReviewCard } from './review-card'
import { createDefaultSchedulingPolicy } from './scheduling-policy'

/**
 * §10: *"A composite exercise generates reviews for the skills it uses."* — one answer,
 * one rating, one row per skill, all tied together by the same `attempt_id`.
 */

const START = Date.UTC(2026, 5, 1, 12)
/** A real `attempts.id` would come from the activity host; the shape is all that matters. */
const ATTEMPT_ID = '019a0000-0000-7000-8000-00000000bbbb'

function harness() {
  const clock = fakeClock(START)
  const store: InMemoryReviewStore = createInMemoryReviewStore(clock)
  const reviewCard = createReviewCard({
    uow: store,
    scheduler: createFsrsScheduler(),
    policy: createDefaultSchedulingPolicy(),
    events: createDomainEventBus(),
    clock,
  })
  const reviewActivity = createReviewActivity({
    reviewCard,
    activityStats: store.activityStats,
    reviewLogs: store.reviewLogs,
  })
  return { clock, store, reviewActivity }
}

/** `cardFixture` and `knowledgeItemFixture` carry a fixed id, so distinct ones are minted
 *  here — several *different* skills is the whole point of a composite activity. */
async function seedCards(store: InMemoryReviewStore, count: number): Promise<Card[]> {
  const cards: Card[] = []
  for (let i = 0; i < count; i++) {
    const suffix = String(i + 1).padStart(4, '0')
    const item = await store.knowledgeItems.create(
      knowledgeItemFixture({ id: `019a0000-0000-7000-8000-00000000a${suffix}` }),
    )
    cards.push(
      await store.cards.create(
        cardFixture({ id: `019a0000-0000-7000-8000-00000000c${suffix}`, itemId: item.id }),
      ),
    )
  }
  return cards
}

const grade = (score: number, correct: boolean, timeMs = 9_000): GradeResult => ({
  score,
  correct,
  meta: { timeMs, attempts: 1, hintsUsed: 0 },
})

const spec = (overrides: Partial<ReviewSpec> = {}): ReviewSpec => ({
  eligible: true,
  rule: 'matching',
  ...overrides,
})

describe('reviewActivity', () => {
  it('writes one log per skill, all sharing the caller’s attempt id', async () => {
    const { store, reviewActivity } = harness()
    const cards = await seedCards(store, 3)

    const result = await reviewActivity({
      activityType: 'matching_pairs',
      skills: cards.map((card) => card.id),
      result: grade(1, true),
      review: spec(),
      attemptId: ATTEMPT_ID,
    })

    expect(result.rating).toBe(3)
    expect(result.reviews).toHaveLength(3)
    const logs = store.reviewLogs.all()
    expect(logs).toHaveLength(3)
    expect(new Set(logs.map((log) => log.attemptId))).toEqual(new Set([ATTEMPT_ID]))
    expect(result.attemptId).toBe(ATTEMPT_ID)
    expect(logs.map((log) => log.cardId).sort()).toEqual(cards.map((card) => card.id).sort())
  })

  it('never invents an attempt id — `review_logs.attempt_id` is a foreign key', async () => {
    const { store, reviewActivity } = harness()
    const cards = await seedCards(store, 2)

    const result = await reviewActivity({
      activityType: 'matching_pairs',
      skills: cards.map((card) => card.id),
      result: grade(1, true),
      review: spec(),
    })

    expect(result.attemptId).toBeNull()
    expect(store.reviewLogs.all().map((log) => log.attemptId)).toEqual([null, null])
  })

  it('applies §9’s exam rule when the session, not the activity, names the context', async () => {
    const { store, reviewActivity } = harness()
    const cards = await seedCards(store, 1)

    // Clean, fast and perfect: daily rules would make this Easy.
    const result = await reviewActivity({
      activityType: 'mcq_single',
      skills: cards.map((card) => card.id),
      result: grade(1, true, 1_000),
      review: spec({ rule: 'binary' }),
      context: 'exam_sim',
    })

    expect(result.rating).toBe(3)
    expect(store.reviewLogs.all()[0]).toMatchObject({ rating: 3, context: 'exam_sim' })
  })

  it('holds a user’s own button to the exam rule too — no Easy in an exam', async () => {
    const { store, reviewActivity } = harness()
    const cards = await seedCards(store, 1)

    const result = await reviewActivity({
      activityType: 'flashcard_basic',
      skills: cards.map((card) => card.id),
      result: grade(1, true),
      review: spec({ rule: 'self' }),
      context: 'exam_sim',
      rating: 4,
    })

    expect(result.rating).toBe(3)
  })

  it('does not second-guess a user’s button outside an exam', async () => {
    const { reviewActivity, store } = harness()
    const cards = await seedCards(store, 1)

    const result = await reviewActivity({
      activityType: 'flashcard_basic',
      skills: cards.map((card) => card.id),
      result: grade(0, false),
      review: spec({ rule: 'self' }),
      rating: 4,
    })

    expect(result.rating).toBe(4)
  })

  it('stamps every row with the activity type and the grader’s continuous score', async () => {
    const { store, reviewActivity } = harness()
    const cards = await seedCards(store, 2)

    await reviewActivity({
      activityType: 'matching_pairs',
      skills: cards.map((card) => card.id),
      result: grade(0.75, false),
      review: spec(),
    })

    for (const log of store.reviewLogs.all()) {
      expect(log.activityType).toBe('matching_pairs')
      expect(log.exerciseScore).toBe(0.75)
      expect(log.durationMs).toBe(9_000)
      // 0.75 is inside §10's matching Hard band, so every skill takes the same rating.
      expect(log.rating).toBe(2)
    }
  })

  it('rates the whole answer once rather than inventing per-skill evidence', async () => {
    const { store, reviewActivity } = harness()
    const cards = await seedCards(store, 4)

    const result = await reviewActivity({
      activityType: 'matching_pairs',
      skills: cards.map((card) => card.id),
      result: grade(0.5, false),
      review: spec(),
    })

    expect(result.rating).toBe(1)
    expect(new Set(store.reviewLogs.all().map((log) => log.rating))).toEqual(new Set([1]))
  })

  it('counts a skill named twice once — two logs would double-count it', async () => {
    const { store, reviewActivity } = harness()
    const [card] = await seedCards(store, 1)

    const result = await reviewActivity({
      activityType: 'matching_pairs',
      skills: [card?.id as string, card?.id as string],
      result: grade(1, true),
      review: spec(),
    })

    expect(result.reviews).toHaveLength(1)
    expect(store.reviewLogs.all()).toHaveLength(1)
  })

  it('writes nothing for a game with chance — M-none does not feed the scheduler', async () => {
    const { store, reviewActivity } = harness()
    const cards = await seedCards(store, 2)

    const result = await reviewActivity({
      activityType: 'memory_game',
      skills: cards.map((card) => card.id),
      result: grade(1, true),
      review: spec({ rule: 'none' }),
    })

    expect(result).toMatchObject({ rating: null, skipped: 'not-eligible' })
    expect(store.reviewLogs.all()).toHaveLength(0)
  })

  it('writes nothing for a lesson-only type', async () => {
    const { store, reviewActivity } = harness()
    const cards = await seedCards(store, 1)

    const result = await reviewActivity({
      activityType: 'disclosure_block',
      skills: cards.map((card) => card.id),
      result: grade(1, true),
      review: spec({ eligible: false }),
    })

    expect(result.skipped).toBe('not-eligible')
    expect(store.reviewLogs.all()).toHaveLength(0)
  })

  it('waits for the user on a self-assessed card, then accepts their button', async () => {
    const { store, reviewActivity } = harness()
    const cards = await seedCards(store, 1)
    const input = {
      activityType: 'flashcard_basic',
      skills: cards.map((card) => card.id),
      result: grade(1, true),
      review: spec({ rule: 'self' }),
    }

    expect(await reviewActivity(input)).toMatchObject({ rating: null, skipped: 'awaiting-user' })
    expect(store.reviewLogs.all()).toHaveLength(0)

    const answered = await reviewActivity({ ...input, rating: 4 })
    expect(answered.rating).toBe(4)
    expect(store.reviewLogs.all()).toHaveLength(1)
  })

  it('reports an activity that named no skills instead of writing nothing silently', async () => {
    const { reviewActivity } = harness()
    expect(
      await reviewActivity({
        activityType: 'mcq_single',
        skills: [],
        result: grade(1, true),
        review: spec({ rule: 'binary' }),
      }),
    ).toMatchObject({ rating: null, skipped: 'no-skills' })
  })

  it('feeds the rolling median, and then reads it back as the personal pace', async () => {
    const { store, reviewActivity } = harness()
    const cards = await seedCards(store, 6)
    const answer = (cardId: string, timeMs: number) =>
      reviewActivity({
        activityType: 'mcq_single',
        skills: [cardId],
        result: grade(1, true, timeMs),
        review: spec({ rule: 'binary' }),
      })

    // Five ordinary answers at 10 s establish the median.
    for (const card of cards.slice(0, 5)) await answer(card.id, 10_000)
    expect(await store.activityStats.medianMs('mcq_single')).toBe(10_000)
    expect(store.reviewLogs.all().every((log) => log.rating === 3)).toBe(true)

    // A sixth at 3 s is now "fast" against that median — §10's Easy.
    const fast = await answer(cards[5]?.id as string, 3_000)
    expect(fast.rating).toBe(4)
  })

  it('falls back to the overall median for a type with no history of its own', async () => {
    const { store, reviewActivity } = harness()
    const cards = await seedCards(store, 4)

    for (const card of cards.slice(0, 3)) {
      await reviewActivity({
        activityType: 'mcq_single',
        skills: [card.id],
        result: grade(1, true, 20_000),
        review: spec({ rule: 'binary' }),
      })
    }
    expect(await store.activityStats.medianMs('true_false')).toBeNull()

    // 5 s is fast against the 20 s the user takes overall, even though `true_false` has
    // never been answered before.
    const first = await reviewActivity({
      activityType: 'true_false',
      skills: [cards[3]?.id as string],
      result: grade(1, true, 5_000),
      review: spec({ rule: 'binary' }),
    })
    expect(first.rating).toBe(4)
  })

  it('rejects an activity with no type — the median and the history are keyed on it', async () => {
    const { reviewActivity } = harness()
    await expect(
      reviewActivity({
        activityType: '',
        skills: ['whatever'],
        result: grade(1, true),
        review: spec(),
      }),
    ).rejects.toThrow(TypeError)
  })
})
