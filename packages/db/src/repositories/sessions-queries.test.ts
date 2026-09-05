import type { UnitOfWork } from '@retenia/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenedDatabase } from '../open-database'
import { openTestDatabase, TEST_DEVICE_ID, type TestClock, testClock, testIds } from '../testing'
import { createRepositories } from './index'

/**
 * The two SQLite queries the runtime activity selector needs (`docs/spec/03-activities.md`
 * §5), neither of which core can express: the skill → activity join over a JSON array, and
 * the per-activity "last served" timestamp behind the 7-day rule.
 */

const DAY_MS = 86_400_000

describe('session generator queries', () => {
  let opened: OpenedDatabase
  let clock: TestClock
  let repos: UnitOfWork

  beforeEach(() => {
    opened = openTestDatabase()
    clock = testClock()
    repos = createRepositories(opened, { deviceId: TEST_DEVICE_ID, clock, ids: testIds(clock) })
  })

  afterEach(() => {
    opened.sqlite.close()
  })

  async function seedActivity(conceptIds: string[], status: 'ready' | 'pending_media' = 'ready') {
    return repos.paths.createActivity({
      lessonId: null,
      ordinal: null,
      type: 'mcq_single',
      family: 'choice',
      schemaVersion: 1,
      lang: 'es-AR',
      bloom: null,
      difficulty: 2,
      conceptIds,
      misconceptionIds: [],
      config: {},
      grading: {},
      status,
      sourceRefs: [],
    })
  }

  describe('listActivitiesByConcepts', () => {
    it('matches an activity on any one of its concepts', async () => {
      const a = await seedActivity(['c1', 'c2'])
      await seedActivity(['c9'])
      const found = await repos.paths.listActivitiesByConcepts(['c2'])
      expect(found.map((row) => row.id)).toEqual([a.id])
    })

    it('returns an activity once even when several of its concepts match', async () => {
      // The join is an EXISTS, not a row-per-match: a duplicate here would let one activity
      // occupy several slots of a session's variety budget.
      const a = await seedActivity(['c1', 'c2', 'c3'])
      const found = await repos.paths.listActivitiesByConcepts(['c1', 'c2', 'c3'])
      expect(found.map((row) => row.id)).toEqual([a.id])
    })

    it('excludes an activity whose media has not been generated yet', async () => {
      // §11: "`pending-media` does not enter a session".
      await seedActivity(['c1'], 'pending_media')
      expect(await repos.paths.listActivitiesByConcepts(['c1'])).toEqual([])
    })

    it('excludes a soft-deleted activity', async () => {
      const a = await seedActivity(['c1'])
      await repos.paths.softDeleteActivity(a.id)
      expect(await repos.paths.listActivitiesByConcepts(['c1'])).toEqual([])
    })

    it('returns nothing for an empty concept list rather than everything', async () => {
      await seedActivity(['c1'])
      expect(await repos.paths.listActivitiesByConcepts([])).toEqual([])
    })

    it('does not match a concept that is merely a substring of another', async () => {
      await seedActivity(['photosynthesis'])
      expect(await repos.paths.listActivitiesByConcepts(['photo'])).toEqual([])
    })
  })

  describe('lastServedAt', () => {
    async function seedAttempt(activityId: string, startedAt: Date, finished = true) {
      return repos.attempts.create({
        activityId,
        context: 'review',
        mode: 'review',
        lessonSessionId: null,
        reviewSessionId: null,
        examAttemptId: null,
        cardId: null,
        startedAt,
        finishedAt: finished ? startedAt : null,
        score: null,
        correct: null,
        rating: null,
        answer: null,
        feedback: null,
        timeMs: null,
        tries: 1,
        hintsUsed: 0,
        confidence: null,
        aiEvalCallId: null,
      })
    }

    it('reports the most recent attempt per activity', async () => {
      const a = await seedActivity(['c1'])
      const base = clock.now().getTime()
      await seedAttempt(a.id, new Date(base - 5 * DAY_MS))
      await seedAttempt(a.id, new Date(base - DAY_MS))
      const served = await repos.attempts.lastServedAt([a.id])
      expect(served.get(a.id)?.getTime()).toBe(base - DAY_MS)
    })

    it('ignores an attempt that was opened but never answered', async () => {
      // The row is created when the activity is *shown*. Counting an unanswered one would
      // let a skipped card suppress that activity for a week.
      const a = await seedActivity(['c1'])
      await seedAttempt(a.id, new Date(clock.now().getTime() - DAY_MS), false)
      expect((await repos.attempts.lastServedAt([a.id])).has(a.id)).toBe(false)
    })

    it('omits an activity that has never been served', async () => {
      // Absent means "never served", which is what the generator reads it as.
      const a = await seedActivity(['c1'])
      expect((await repos.attempts.lastServedAt([a.id])).has(a.id)).toBe(false)
    })

    it('returns an empty map for an empty id list without querying', async () => {
      expect(await repos.attempts.lastServedAt([])).toEqual(new Map())
    })

    it('ignores a soft-deleted attempt', async () => {
      const a = await seedActivity(['c1'])
      const attempt = await seedAttempt(a.id, new Date(clock.now().getTime() - DAY_MS))
      await repos.attempts.softDelete(attempt.id)
      expect((await repos.attempts.lastServedAt([a.id])).has(a.id)).toBe(false)
    })
  })

  describe('listByReviewSession', () => {
    it('finds the attempts recorded during one daily session', async () => {
      const a = await seedActivity(['c1'])
      const session = await repos.reviewSessions.create({
        status: 'in_progress',
        startedAt: clock.now(),
        finishedAt: null,
        durationMs: null,
        seed: 'seed',
        plan: {},
        progress: {},
        reviewed: 0,
        again: 0,
        hard: 0,
        postponed: 0,
        accuracy: null,
        xp: 0,
        summary: null,
      })
      const attempt = await repos.attempts.create({
        activityId: a.id,
        context: 'review',
        mode: 'review',
        lessonSessionId: null,
        reviewSessionId: session.id,
        examAttemptId: null,
        cardId: null,
        startedAt: clock.now(),
        finishedAt: null,
        score: null,
        correct: null,
        rating: null,
        answer: null,
        feedback: null,
        timeMs: null,
        tries: 1,
        hintsUsed: 0,
        confidence: null,
        aiEvalCallId: null,
      })
      const found = await repos.attempts.listByReviewSession(session.id)
      expect(found.map((row) => row.id)).toEqual([attempt.id])
      expect(found[0]?.mode).toBe('review')
    })
  })
})
