import type { Card, ImportanceLevel, ReviewLog } from '../entities'
import type { LeechDecision } from './leech'
import type { SchedulingOptions } from './types'

/** The scheduling fields of a card as they were before a review. */
export interface MemorySnapshot {
  state: Card['state']
  due: Date
  stability: number
  difficulty: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  lastReview: Date | null
}

/**
 * Published after `reviewCard` commits — never inside the transaction, so a listener sees
 * only durable state and cannot roll a review back by throwing. XP, streaks, the queue's
 * invalidation and the statistics all hang off it. Rating 0 (a postpone) publishes the
 * same event; `log.rating` tells them apart.
 */
export interface CardReviewedEvent {
  readonly type: 'card.reviewed'
  /** The card after the review. */
  readonly card: Card
  /** The row that was appended. */
  readonly log: ReviewLog
  readonly previous: MemorySnapshot
  /** `R` at the moment of the review — "you recalled this at ~82 %". */
  readonly retrievabilityBefore: number
  readonly options: SchedulingOptions
}

export function memorySnapshot(card: Card): MemorySnapshot {
  return {
    state: card.state,
    due: new Date(card.due.getTime()),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduledDays,
    learningSteps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.lastReview === null ? null : new Date(card.lastReview.getTime()),
  }
}

/**
 * Published after a review pushed a card to or past its level's leech threshold (§4).
 *
 * Separate from `card.reviewed` rather than a flag on it because it is a different kind of
 * fact with different listeners: the review screen interrupts the queue, the AI layer
 * offers a rewrite (7.x), statistics counts leeches. Both events are published for the same
 * review, in that order, and both only after the transaction commits.
 */
export interface CardLeechEvent {
  readonly type: 'card.leech'
  /** The card after the review, with `leech` (and possibly `suspended`) already set. */
  readonly card: Card
  readonly decision: LeechDecision
  /** The level whose threshold and action applied. */
  readonly level: ImportanceLevel
}
