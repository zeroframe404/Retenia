import { type Card, REVIEW_CONTEXTS, type ReviewContext, type ReviewLog } from '../entities'
import type { EntityPatch } from '../ports/audit'
import type { CardRepository } from '../ports/card-repository'
import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import type { DomainEventPublisher } from '../ports/domain-events'
import { EntityNotFoundError } from '../ports/errors'
import type { KnowledgeItemRepository } from '../ports/knowledge-item-repository'
import type { ReviewLogRepository } from '../ports/review-log-repository'
import { type MemorySnapshot, memorySnapshot } from './events'
import type { SchedulingPolicy } from './scheduling-policy'
import type { Grade, Scheduler, SchedulingOptions, SchedulingResult } from './types'

/**
 * The `ReviewCard` use case: one answer → one appended `review_logs` row and one updated
 * card, in one transaction, then one `card.reviewed` event.
 *
 * Reads happen first and outside the transaction (the policy may do I/O); the writes then
 * open the transaction with everything in hand and only await repository calls inside it
 * (`UnitOfWork.transaction`'s contract). The card is written with its `version` as an
 * optimistic-concurrency token: two answers to the same card racing each other cannot
 * both win, and the loser's log is rolled back with its card update.
 */

/** The slice of the unit of work this use case touches — what the real `UnitOfWork`
 *  provides and what an in-memory double needs to implement. */
export interface ReviewRepositories {
  cards: Pick<CardRepository, 'findById' | 'update'>
  knowledgeItems: Pick<KnowledgeItemRepository, 'findById'>
  reviewLogs: Pick<ReviewLogRepository, 'append'>
}

export interface ReviewUnitOfWork extends ReviewRepositories {
  transaction<T>(work: (repos: ReviewRepositories) => Promise<T> | T): Promise<T>
}

export interface ReviewCardDeps {
  uow: ReviewUnitOfWork
  scheduler: Scheduler
  policy: SchedulingPolicy
  events: DomainEventPublisher
  /** Only consulted when the input names no `now`. */
  clock?: Clock
}

interface ReviewCardBase {
  cardId: string
  /** Review time, UTC. Defaults to the clock. */
  now?: Date
  durationMs?: number | null
  /** `daily` for a grade, `manual_postpone` for rating 0, unless given. */
  context?: ReviewContext
  /** The grader's continuous score in `[0, 1]`, when an exercise produced the rating. */
  exerciseScore?: number | null
  device?: string | null
  attemptId?: string | null
}

/** A grade, or rating 0 (`Manual`) with the due date the card is postponed to. */
export type ReviewCardInput =
  | (ReviewCardBase & { rating: Grade; due?: undefined })
  | (ReviewCardBase & { rating: 0; due: Date })

export interface ReviewCardResult {
  /** The card as stored after the review. */
  card: Card
  /** The log row as stored. */
  log: ReviewLog
  previous: MemorySnapshot
  /** The options the policy resolved for this review. */
  options: SchedulingOptions
}

export type ReviewCard = (input: ReviewCardInput) => Promise<ReviewCardResult>

function assertValidDate(name: string, value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`reviewCard: ${name} must be a valid Date`)
  }
  return value
}

function optionalNumber(
  name: string,
  value: number | null | undefined,
  min: number,
  max: number,
): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`reviewCard: ${name} must be a number in [${min}, ${max}] or null`)
  }
  return value
}

function optionalString(name: string, value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new TypeError(`reviewCard: ${name} must be a string or null`)
  return value
}

function fsrsPatch(card: Card, version: number): EntityPatch<Card> {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduledDays,
    learningSteps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.lastReview,
    version,
  }
}

export function createReviewCard(deps: ReviewCardDeps): ReviewCard {
  const { uow, scheduler, policy, events } = deps
  const clock = deps.clock ?? systemClock

  return async (input) => {
    const { rating } = input
    if (rating !== 0 && rating !== 1 && rating !== 2 && rating !== 3 && rating !== 4) {
      throw new RangeError(
        `reviewCard: rating must be 0 (Manual) … 4 (Easy), got ${String(rating)}`,
      )
    }
    const now = input.now === undefined ? clock.now() : assertValidDate('now', input.now)
    const context: ReviewContext = input.context ?? (rating === 0 ? 'manual_postpone' : 'daily')
    if (!REVIEW_CONTEXTS.includes(context)) {
      throw new RangeError(`reviewCard: unknown context "${String(context)}"`)
    }
    const durationMs = optionalNumber('durationMs', input.durationMs, 0, Number.MAX_SAFE_INTEGER)
    const exerciseScore = optionalNumber('exerciseScore', input.exerciseScore, 0, 1)
    const device = optionalString('device', input.device)
    const attemptId = optionalString('attemptId', input.attemptId)
    const due = rating === 0 ? assertValidDate('due', input.due) : null

    const card = await uow.cards.findById(input.cardId)
    if (card === undefined) throw new EntityNotFoundError('cards', input.cardId)
    const item = (await uow.knowledgeItems.findById(card.itemId)) ?? null
    const options = await policy.optionsFor({ card, item, now })

    const previous = memorySnapshot(card)
    const retrievabilityBefore = scheduler.retrievability(card, now)
    const result: SchedulingResult =
      due === null
        ? scheduler.apply(card, now, rating as Grade, options)
        : scheduler.postpone(card, now, due)

    const written = await uow.transaction(async (repos) => {
      const saved = await repos.cards.update(card.id, fsrsPatch(result.card, card.version))
      const log = await repos.reviewLogs.append({
        ...result.log,
        durationMs,
        context,
        exerciseScore,
        device,
        attemptId,
      })
      return { saved, log }
    })

    events.publish({
      type: 'card.reviewed',
      card: written.saved,
      log: written.log,
      previous,
      retrievabilityBefore,
      options,
    })
    return { card: written.saved, log: written.log, previous, options }
  }
}
