import type { Card, Exam, KnowledgeItem, ReviewLog } from '../entities'

/**
 * Entity builders for scheduler and review tests: a `New` card, an active item, a log, an
 * upcoming dated exam — every field present, every override optional.
 */

const EPOCH = new Date('2026-01-05T08:00:00.000Z')

function audit(at: Date = EPOCH) {
  return { createdAt: at, updatedAt: at, deletedAt: null, deviceId: 'test-device', version: 1 }
}

export function knowledgeItemFixture(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: '019a0000-0000-7000-8000-00000000aaaa',
    lessonId: null,
    topicId: null,
    kind: 'fact',
    fields: { front: 'q', back: 'a' },
    sourceId: null,
    annotationId: null,
    locator: null,
    asOf: null,
    importance: 'normal',
    status: 'active',
    createdBy: 'user',
    tags: [],
    ...audit(),
    ...overrides,
  }
}

/** A card that has never been reviewed, due at `EPOCH`. */
export function cardFixture(overrides: Partial<Card> = {}): Card {
  return {
    id: '019a0000-0000-7000-8000-00000000cccc',
    itemId: '019a0000-0000-7000-8000-00000000aaaa',
    template: 'basic',
    payload: null,
    due: EPOCH,
    stability: 0,
    difficulty: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    lastReview: null,
    suspended: false,
    buriedUntil: null,
    leech: false,
    importanceOverride: null,
    importanceOverrideExpiresAt: null,
    examId: null,
    ...audit(),
    ...overrides,
  }
}

export function reviewLogFixture(overrides: Partial<ReviewLog> = {}): ReviewLog {
  return {
    id: '019a0000-0000-7000-8000-00000000eeee',
    cardId: '019a0000-0000-7000-8000-00000000cccc',
    rating: 3,
    state: 2,
    due: EPOCH,
    stability: 5,
    difficulty: 5,
    elapsedDays: 1,
    scheduledDays: 3,
    learningSteps: 0,
    review: EPOCH,
    durationMs: null,
    context: 'daily',
    exerciseScore: null,
    device: null,
    attemptId: null,
    algorithmVersion: 'fsrs6',
    ...audit(),
    ...overrides,
  }
}

/** A planned, dated exam two weeks out, with the spec's 0.95 target and 3-day final
 *  window (`docs/spec/02-memory-system.md` §8). */
export function examFixture(overrides: Partial<Exam> = {}): Exam {
  return {
    id: '019a0000-0000-7000-8000-00000000bbbb',
    title: 'Physiology final',
    kind: 'dated',
    date: '2026-01-19',
    pathId: null,
    scope: {},
    blueprint: [],
    targetRetention: 0.95,
    finalWindowDays: 3,
    studyDaysMask: 127,
    dailyCapacityMinutes: null,
    status: 'active',
    ...audit(),
    ...overrides,
  }
}
