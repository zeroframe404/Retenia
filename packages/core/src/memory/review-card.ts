import { type Card, REVIEW_CONTEXTS, type ReviewContext, type ReviewLog } from '../entities'
import type { ActivityStatsRepository } from '../ports/activity-stats-repository'
import type { EntityPatch } from '../ports/audit'
import type { CardRepository } from '../ports/card-repository'
import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import type { DomainEventPublisher } from '../ports/domain-events'
import { EntityNotFoundError } from '../ports/errors'
import type { KnowledgeItemRepository } from '../ports/knowledge-item-repository'
import type { ReviewLogRepository } from '../ports/review-log-repository'
import { type MemorySnapshot, memorySnapshot } from './events'
import { evaluateLeech, type LeechDecision } from './leech'
import type {
  ImportanceResolution,
  SchedulingPolicy,
  SchedulingPolicyInput,
} from './scheduling-policy'
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
  /**
   * Where the rolling per-type median is kept up to date (§10's "personal median").
   *
   * Optional, because it is **derived state**: a caller wired without it still schedules
   * correctly, it just never learns how fast this user is at this type, and `toRating`
   * then declines to read speed as evidence. Making it required would force every
   * in-memory double in the codebase to grow a table that changes no scheduling outcome.
   */
  activityStats?: Pick<ActivityStatsRepository, 'record'>
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
  /**
   * The full importance resolution, when the caller has one.
   *
   * `policy.optionsFor` answers only "what should the scheduler do"; §4's leech handling
   * also needs the level's `leechThreshold` and `leechAction`, which live on the same
   * resolution. A caller that supplies this gets leech detection and pays for one resolve
   * instead of two; one that does not keeps working exactly as before, minus leeches.
   */
  resolve?: (input: SchedulingPolicyInput) => ImportanceResolution | Promise<ImportanceResolution>
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
  /** The activity type that produced the rating (`mcq_single`, `cloze_typed`, …), or null
   *  for a button pressed on a plain flashcard. Also the key of the rolling median. */
  activityType?: string | null
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
  /** §4's verdict on the card after this review, or `null` when the caller supplied no
   *  `resolve` and leeches were therefore not evaluated. */
  leech: LeechDecision | null
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
    const activityType = optionalString('activityType', input.activityType)
    const due = rating === 0 ? assertValidDate('due', input.due) : null

    const card = await uow.cards.findById(input.cardId)
    if (card === undefined) throw new EntityNotFoundError('cards', input.cardId)
    const item = (await uow.knowledgeItems.findById(card.itemId)) ?? null
    const resolution = deps.resolve === undefined ? null : await deps.resolve({ card, item, now })
    const options =
      resolution === null ? await policy.optionsFor({ card, item, now }) : resolution.options

    const previous = memorySnapshot(card)
    const retrievabilityBefore = scheduler.retrievability(card, now)
    const result: SchedulingResult =
      due === null
        ? scheduler.apply(card, now, rating as Grade, options)
        : scheduler.postpone(card, now, due)

    // Evaluated on the card *after* the review, so `lapses` already counts this Again.
    // Rating 0 is a postpone and never a lapse, so it can never make a card a leech.
    const leech =
      resolution === null
        ? null
        : evaluateLeech({ card: result.card, settings: resolution.settings })

    const written = await uow.transaction(async (repos) => {
      // One write, not three. `setLeech`/`setSuspended` exist for the manual menu path;
      // here they would be a second and third update of the same row inside one
      // transaction, each bumping `version`, and the optimistic-concurrency token the
      // first one checked would already be stale.
      const saved = await repos.cards.update(card.id, {
        ...fsrsPatch(result.card, card.version),
        ...(leech?.tag === true ? { leech: true } : {}),
        ...(leech?.suspend === true ? { suspended: true } : {}),
      })
      const log = await repos.reviewLogs.append({
        ...result.log,
        durationMs,
        context,
        exerciseScore,
        device,
        attemptId,
        activityType,
      })
      // Inside the transaction so the median and the review it was measured from commit or
      // roll back together. Only a real grade counts: rating `Manual` is a postpone, which
      // takes no time (`fsrs-rules`), and an unmeasured answer is not evidence of speed.
      if (
        repos.activityStats !== undefined &&
        activityType !== null &&
        rating !== 0 &&
        durationMs !== null &&
        durationMs > 0
      ) {
        await repos.activityStats.record(activityType, durationMs)
      }
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
    // After `card.reviewed`: a listener that reacts to a leech wants the review it came
    // from already accounted for.
    if (leech !== null && resolution !== null && leech.stage !== 'none') {
      events.publish({
        type: 'card.leech',
        card: written.saved,
        decision: leech,
        level: resolution.level,
      })
    }
    return { card: written.saved, log: written.log, previous, options, leech }
  }
}
