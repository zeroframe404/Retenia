import type { Card, ImportanceLevel, KnowledgeItem, UnitOfWork } from '@retenia/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenedDatabase } from '../open-database'
import { openTestDatabase, TEST_DEVICE_ID, type TestClock, testClock, testIds } from '../testing'
import { createRepositories } from './index'

/**
 * The SQLite side of `docs/spec/02-memory-system.md` §13: the two joined projections the
 * statistics read, and the rolling per-type median of §10.
 *
 * What is worth proving here rather than in `packages/core` is exactly what the join adds:
 * that the **effective** importance level comes out — override, expiry and all — and that a
 * soft-deleted review disappears from the history the way undo requires.
 */

const DAY_MS = 86_400_000

describe('stats repository', () => {
  let opened: OpenedDatabase
  let clock: TestClock
  let repos: UnitOfWork

  beforeEach(() => {
    opened = openTestDatabase()
    clock = testClock()
    repos = createRepositories(opened, {
      deviceId: TEST_DEVICE_ID,
      clock,
      ids: testIds(clock),
    })
  })

  afterEach(() => {
    opened.sqlite.close()
  })

  async function seedItem(importance: ImportanceLevel = 'normal'): Promise<KnowledgeItem> {
    return repos.knowledgeItems.create({
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

  async function seedCard(overrides: Partial<Card> = {}, item?: KnowledgeItem): Promise<Card> {
    const owner = item ?? (await seedItem())
    return repos.cards.create({
      itemId: owner.id,
      template: 'basic',
      payload: null,
      due: clock.now(),
      stability: 10,
      difficulty: 5,
      scheduledDays: 10,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      state: 2,
      lastReview: clock.now(),
      suspended: false,
      buriedUntil: null,
      leech: false,
      importanceOverride: null,
      importanceOverrideExpiresAt: null,
      examId: null,
      ...overrides,
    })
  }

  async function seedLog(card: Card, overrides: Record<string, unknown> = {}) {
    return repos.reviewLogs.append({
      cardId: card.id,
      rating: 3,
      state: 2,
      due: clock.now(),
      stability: 8,
      difficulty: 5,
      elapsedDays: 5,
      scheduledDays: 10,
      learningSteps: 0,
      review: clock.now(),
      durationMs: 6_000,
      context: 'daily',
      exerciseScore: 0.9,
      device: null,
      attemptId: null,
      activityType: 'mcq_single',
      algorithmVersion: 'fsrs6',
      ...overrides,
    })
  }

  const window = () => ({
    from: new Date(clock.nowMs() - DAY_MS),
    to: new Date(clock.nowMs() + DAY_MS),
  })

  it('carries the item’s importance onto every review', async () => {
    const item = await seedItem('high')
    await seedLog(await seedCard({}, item))

    const { from, to } = window()
    const [event] = await repos.stats.listReviewEvents(from, to)
    expect(event?.level).toBe('high')
    expect(event?.activityType).toBe('mcq_single')
    expect(event?.durationMs).toBe(6_000)
  })

  it('prefers an unexpired per-card override over the item’s level (§7 rule 1)', async () => {
    const item = await seedItem('normal')
    const card = await seedCard(
      {
        importanceOverride: 'urgent',
        importanceOverrideExpiresAt: new Date(clock.nowMs() + DAY_MS),
      },
      item,
    )
    await seedLog(card)

    const { from, to } = window()
    const [event] = await repos.stats.listReviewEvents(from, to)
    expect(event?.level).toBe('urgent')
    const [state] = await repos.stats.listMemoryStates()
    expect(state?.level).toBe('urgent')
  })

  it('ignores a lapsed override, exactly as the scheduler does on read', async () => {
    const item = await seedItem('normal')
    const card = await seedCard(
      {
        importanceOverride: 'urgent',
        importanceOverrideExpiresAt: new Date(clock.nowMs() - 1),
      },
      item,
    )
    await seedLog(card)

    const { from, to } = window()
    const [event] = await repos.stats.listReviewEvents(from, to)
    expect(event?.level).toBe('normal')
  })

  it('returns reviews oldest first — `firstOfDay` depends on the order', async () => {
    const card = await seedCard()
    const base = clock.nowMs()
    await seedLog(card, { review: new Date(base - 3_000) })
    await seedLog(card, { review: new Date(base - 1_000) })
    await seedLog(card, { review: new Date(base - 2_000) })

    const { from, to } = window()
    const events = await repos.stats.listReviewEvents(from, to)
    expect(events.map((event) => event.review.getTime())).toEqual([
      base - 3_000,
      base - 2_000,
      base - 1_000,
    ])
  })

  it('excludes a review that undo soft-deleted', async () => {
    const card = await seedCard()
    const log = await seedLog(card)
    const { from, to } = window()
    expect(await repos.stats.listReviewEvents(from, to)).toHaveLength(1)

    await repos.reviewLogs.softDeleteById(log.id, clock.now())
    expect(await repos.stats.listReviewEvents(from, to)).toHaveLength(0)
  })

  it('excludes reviews outside the window, and honours the limit', async () => {
    const card = await seedCard()
    await seedLog(card, { review: new Date(clock.nowMs() - 10 * DAY_MS) })
    await seedLog(card)
    await seedLog(card)

    const { from, to } = window()
    expect(await repos.stats.listReviewEvents(from, to)).toHaveLength(2)
    expect(await repos.stats.listReviewEvents(from, to, { limit: 1 })).toHaveLength(1)
  })

  it('reads live memory states and leaves suspended, deleted and inactive cards out', async () => {
    const kept = await seedCard()
    const suspended = await seedCard()
    await repos.cards.setSuspended(suspended.id, true)
    const deleted = await seedCard()
    await repos.cards.softDelete(deleted.id)
    const parked = await seedItem()
    await repos.knowledgeItems.update(parked.id, { status: 'need_to_learn' })
    await seedCard({}, parked)

    const states = await repos.stats.listMemoryStates()
    expect(states.map((state) => state.cardId)).toEqual([kept.id])
    expect(states[0]).toMatchObject({ stability: 10, difficulty: 5, state: 2 })
  })

  it('counts a paused item: pausing an item does not unlearn it', async () => {
    const item = await seedItem('paused')
    const card = await seedCard({}, item)
    const states = await repos.stats.listMemoryStates()
    expect(states.map((state) => state.cardId)).toEqual([card.id])
    expect(states[0]?.level).toBe('paused')
  })
})

describe('activity stats repository', () => {
  let opened: OpenedDatabase
  let clock: TestClock
  let repos: UnitOfWork

  beforeEach(() => {
    opened = openTestDatabase()
    clock = testClock()
    repos = createRepositories(opened, {
      deviceId: TEST_DEVICE_ID,
      clock,
      ids: testIds(clock),
    })
  })

  afterEach(() => {
    opened.sqlite.close()
  })

  it('creates a type’s row on its first review and keeps the median current', async () => {
    expect(await repos.activityStats.medianMs('mcq_single')).toBeNull()

    await repos.activityStats.record('mcq_single', 10_000)
    expect(await repos.activityStats.medianMs('mcq_single')).toBe(10_000)

    await repos.activityStats.record('mcq_single', 2_000)
    await repos.activityStats.record('mcq_single', 6_000)
    const pace = await repos.activityStats.find('mcq_single')
    expect(pace).toMatchObject({ reviews: 3, medianMs: 6_000 })
    expect(pace?.sample).toEqual([10_000, 2_000, 6_000])
  })

  it('keeps one row per type, upserting rather than inserting again', async () => {
    await repos.activityStats.record('mcq_single', 5_000)
    await repos.activityStats.record('mcq_single', 7_000)
    await repos.activityStats.record('cloze_typed', 20_000)

    const all = await repos.activityStats.list()
    expect(all.map((row) => row.activityType)).toEqual(['cloze_typed', 'mcq_single'])
    expect(await repos.activityStats.medianMs('cloze_typed')).toBe(20_000)
  })

  it('bumps `version` on each real update, as a synced row must', async () => {
    await repos.activityStats.record('mcq_single', 5_000)
    await repos.activityStats.record('mcq_single', 6_000)
    const [row] = opened.sqlite
      .prepare('SELECT version, reviews FROM activity_stats WHERE activity_type = ?')
      .all('mcq_single') as Array<{ version: number; reviews: number }>
    expect(row).toEqual({ version: 2, reviews: 2 })
  })

  it('does not write at all for a duration it will not count', async () => {
    await repos.activityStats.record('mcq_single', 5_000)
    await repos.activityStats.record('mcq_single', 0)
    await repos.activityStats.record('mcq_single', -1)

    const [row] = opened.sqlite
      .prepare('SELECT version, reviews FROM activity_stats WHERE activity_type = ?')
      .all('mcq_single') as Array<{ version: number; reviews: number }>
    expect(row).toEqual({ version: 1, reviews: 1 })
  })

  it('creates nothing for a first review that was never timed', async () => {
    await repos.activityStats.record('mcq_single', 0)
    expect(await repos.activityStats.find('mcq_single')).toBeUndefined()
    expect(await repos.activityStats.list()).toEqual([])
  })
})
