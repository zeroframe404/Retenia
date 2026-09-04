import type { CardState, ImportanceLevel, Rating, ReviewContext } from '../entities'

/**
 * The two projections `packages/core/src/stats` reads.
 *
 * Projections rather than whole entities, and a port of their own rather than methods on
 * `CardRepository`/`ReviewLogRepository`, because every metric in `docs/spec/02-memory-
 * system.md` §13 needs the **effective importance level** alongside the row — and that
 * lives two joins away (`review_logs → cards → knowledge_items.importance`, with
 * `cards.importance_override` on top). Reading the entities and joining in JavaScript would
 * turn "desired vs true retention per level" into one query per review.
 *
 * Both are read-only and neither has a `deleted_at` of its own to think about: the adapter
 * excludes soft-deleted rows, which is what makes an undone review disappear from the
 * statistics exactly as `.claude/skills/fsrs-rules/SKILL.md` requires.
 */

/** One review, with everything §13's first six rows group by. */
export interface ReviewEvent {
  cardId: string
  /** `cards.importance_override` (while unexpired) or the item's `importance`. */
  level: ImportanceLevel
  rating: Rating
  /** The card's state **before** the review — §13's true retention counts `Review` only. */
  state: CardState
  /** The interval that had been scheduled, in days: `< 21` is "young", `≥ 21` "mature". */
  scheduledDays: number
  /** The card's stability before the review; with `due` it reconstructs past state. */
  stability: number
  difficulty: number
  /** As `ts-fsrs` stores it: the card's *previous* `lastReview`, or its `due` when it had
   *  never been reviewed. What "how long had it been?" is measured from. */
  due: Date
  review: Date
  durationMs: number | null
  context: ReviewContext
  activityType: string | null
}

/** One live card's memory state — the input to every "right now" metric. */
export interface CardMemoryState {
  cardId: string
  level: ImportanceLevel
  state: CardState
  stability: number
  difficulty: number
  due: Date
  lastReview: Date | null
}

export interface StatsReadOptions {
  /** Hard ceiling on rows returned, so one screen cannot read an unbounded table. */
  limit?: number
}

export interface StatsRepository {
  /**
   * Reviews in `[from, to)`, oldest first. Soft-deleted rows and the cards behind them are
   * excluded; rating `Manual` rows are **included**, because a postpone is part of the
   * history even though no metric counts it as an answer — the queries filter it out
   * themselves, where the reason for doing so can be stated.
   */
  listReviewEvents(from: Date, to: Date, options?: StatsReadOptions): Promise<ReviewEvent[]>
  /**
   * Every live, unsuspended card's memory state. `paused` is included, unlike everywhere in
   * the scheduler: §13's "memorized knowledge" is what the user *knows*, and pausing an
   * item does not unlearn it.
   */
  listMemoryStates(options?: StatsReadOptions): Promise<CardMemoryState[]>
}
