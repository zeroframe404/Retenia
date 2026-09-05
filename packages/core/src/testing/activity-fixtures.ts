import type { ImportanceLevel } from '../entities'
import type { SessionCardEntry } from '../memory/session'
import type { ActivityOption } from '../sessions/activity-option'
import { cardFixture } from './memory-fixtures'

/**
 * Builders for the session generator's two inputs: one candidate activity, and one due entry
 * of a `SessionPlan`.
 *
 * They live under `src/testing/` because `vitest.config.ts` excludes that directory from the
 * coverage denominator — a builder's own optional-override branches are not logic anyone
 * needs to prove.
 */

let sequence = 0

/** Ids are UUIDv7-shaped so a fixture can be handed to a repository unchanged. */
export function nextActivityId(): string {
  sequence += 1
  return `019a0000-0000-7000-8000-${String(sequence).padStart(12, '0')}`
}

export function activityOptionFixture(overrides: Partial<ActivityOption> = {}): ActivityOption {
  return {
    activityId: nextActivityId(),
    type: 'mcq_single',
    family: 'choice',
    progression: 'recognition',
    ratingStrategy: 'binary',
    expectedSeconds: 20,
    eligible: true,
    hasMedia: false,
    needsMic: false,
    needsSandbox: false,
    difficulty: 2,
    bloom: 'remember',
    conceptIds: ['concept-1'],
    lastServedAt: null,
    ...overrides,
  }
}

export interface CardEntrySpec {
  stability?: number
  kind?: SessionCardEntry['kind']
  level?: ImportanceLevel
  cardId?: string
  reps?: number
}

/** A `due` entry whose card has the given stability — the generator's only real input. */
export function cardEntryFixture(spec: CardEntrySpec = {}): SessionCardEntry {
  return {
    kind: spec.kind ?? 'due',
    card: cardFixture({
      id: spec.cardId ?? nextActivityId(),
      stability: spec.stability ?? 0,
      reps: spec.reps ?? 1,
    }),
    level: spec.level ?? 'normal',
    // The generator never reads the scheduling options — it chooses *what is asked*, never
    // how the answer is scheduled — so a minimal valid set keeps the fixture honest.
    options: {
      desiredRetention: 0.9,
      maxIntervalDays: 36_500,
      learningSteps: [],
      relearningSteps: [],
      fuzz: false,
    },
    retrievability: 0.9,
    relativeOverdueness: 1,
    examId: null,
  }
}
