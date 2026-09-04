import type { Card, ImportanceLevel, KnowledgeItem, ReviewContext, ReviewLog } from '../entities'
import { IMPORTANCE_LEVELS } from '../entities'
import type { CardRepository } from '../ports/card-repository'
import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import type { KnowledgeItemRepository } from '../ports/knowledge-item-repository'
import type { ReviewLogRepository } from '../ports/review-log-repository'
import type { ImportanceResolution, SchedulingPolicyInput } from './scheduling-policy'
import { DAY_MS } from './study-day'
import { CARD_STATE, type Scheduler } from './types'

/**
 * "Reschedule now", and the simulation that must precede it
 * (`docs/spec/02-memory-system.md` §7 rule 2).
 *
 * Changing an importance level **never** reschedules en masse — that is Anki's "reschedule
 * cards on change = off", and it is what keeps a level change from silently dumping five
 * hundred cards into today. The new desired retention applies from the next review. This
 * module is the explicit opt-in: it shows what applying the change *would* cost, and only
 * writes when the user confirms.
 *
 * The projection is the same arithmetic Anki uses for a retention change: recompute the
 * interval from the card's **current** stability under the new retention. It deliberately
 * does **not** replay the review history — `Scheduler.reschedule(card, history, options)`
 * is the parameter-change path of §14 (after an optimizer run or an import), it recomputes
 * S and D, and importance may never do that (`.claude/skills/fsrs-rules/SKILL.md`).
 */

export interface RescheduleChange {
  cardId: string
  level: ImportanceLevel
  currentDue: Date
  newDue: Date
  currentIntervalDays: number
  newIntervalDays: number
  /** `newDue − currentDue`, in whole days. Negative when the card comes forward. */
  deltaDays: number
  desiredRetention: number
}

export interface RescheduleWindow {
  before: number
  after: number
  delta: number
}

export interface RescheduleImpact {
  /** Cards whose due date would move. */
  affected: number
  /** Cards the projection cannot move, and why. */
  skipped: {
    /** `New`, `Learning` or `Relearning`: no long-term interval to recompute yet. */
    notInReview: number
    /** In `Review` but with no stability or no last review — an imported husk. */
    noMemoryState: number
    /** Projected onto the same day they already sit on. */
    unchanged: number
  }
  /** Cards due in the next seven days, before and after. */
  dueInSevenDays: RescheduleWindow
  /** Steady-state load, `Σ 1 / interval` — reviews a day once the schedule settles. */
  reviewsPerDay: RescheduleWindow
  byLevel: Record<ImportanceLevel, { affected: number; dueInSevenDaysDelta: number }>
  changes: readonly RescheduleChange[]
  computedAt: Date
}

/** A card paired with the resolution that governs it. */
export interface RescheduleCandidate {
  card: Card
  resolution: ImportanceResolution
}

function emptyByLevel(): Record<
  ImportanceLevel,
  { affected: number; dueInSevenDaysDelta: number }
> {
  return Object.fromEntries(
    IMPORTANCE_LEVELS.map((level) => [level, { affected: 0, dueInSevenDaysDelta: 0 }]),
  ) as Record<ImportanceLevel, { affected: number; dueInSevenDaysDelta: number }>
}

/**
 * The whole computation, pure: candidates in, impact out. No repository, no clock, no
 * writes — the reason `simulateReschedule` can promise side-effect freedom.
 *
 * The new due date is anchored at the card's **last review**, never at `now`. Anchoring at
 * `now` would silently push every overdue card forward; a projected due date in the past
 * simply means "due immediately", which is exactly what raising the retention asks for.
 *
 * No fuzz: fuzz is seeded per card and review inside `apply`, and a reschedule is not a
 * review. Spreading the resulting dates is the load balancer's job (sub-phase 4.3).
 */
export function projectReschedule(
  candidates: readonly RescheduleCandidate[],
  now: Date,
  scheduler: Pick<Scheduler, 'intervalFor'>,
): RescheduleImpact {
  const sevenDays = now.getTime() + 7 * DAY_MS
  const changes: RescheduleChange[] = []
  const byLevel = emptyByLevel()
  const skipped = { notInReview: 0, noMemoryState: 0, unchanged: 0 }
  let dueBefore = 0
  let dueAfter = 0
  let loadBefore = 0
  let loadAfter = 0

  for (const { card, resolution } of candidates) {
    if (card.state !== CARD_STATE.Review) {
      skipped.notInReview += 1
      continue
    }
    if (card.stability <= 0 || card.lastReview === null) {
      skipped.noMemoryState += 1
      continue
    }

    const { desiredRetention, maxIntervalDays } = resolution.options
    const raw = scheduler.intervalFor(desiredRetention, { stability: card.stability })
    const newIntervalDays = Math.min(Math.max(1, Math.round(raw)), maxIntervalDays)
    const newDue = new Date(card.lastReview.getTime() + newIntervalDays * DAY_MS)

    const wasDueSoon = card.due.getTime() <= sevenDays
    const isDueSoon = newDue.getTime() <= sevenDays
    if (wasDueSoon) dueBefore += 1
    if (isDueSoon) dueAfter += 1
    loadBefore += 1 / Math.max(1, card.scheduledDays)
    loadAfter += 1 / newIntervalDays

    const deltaDays = Math.round((newDue.getTime() - card.due.getTime()) / DAY_MS)
    if (newDue.getTime() === card.due.getTime()) {
      skipped.unchanged += 1
      continue
    }

    const bucket = byLevel[resolution.level]
    bucket.affected += 1
    bucket.dueInSevenDaysDelta += (isDueSoon ? 1 : 0) - (wasDueSoon ? 1 : 0)
    changes.push({
      cardId: card.id,
      level: resolution.level,
      currentDue: card.due,
      newDue,
      currentIntervalDays: card.scheduledDays,
      newIntervalDays,
      deltaDays,
      desiredRetention,
    })
  }

  return {
    affected: changes.length,
    skipped,
    dueInSevenDays: { before: dueBefore, after: dueAfter, delta: dueAfter - dueBefore },
    reviewsPerDay: {
      before: loadBefore,
      after: loadAfter,
      delta: loadAfter - loadBefore,
    },
    byLevel,
    changes: Object.freeze(changes),
    computedAt: now,
  }
}

/**
 * How many cards one projection covers when the caller names none.
 *
 * The IPC schema defaults `limit` too, so this is defence in depth for a caller that does
 * not come through the bridge: an unbounded `list()` here is one synchronous read of the
 * whole `cards` table, and for `rescheduleNow` a transaction writing four rows per card.
 */
export const DEFAULT_RESCHEDULE_LIMIT = 2_000

/** Which cards to project. Every field is optional; with none of them, the first
 *  `DEFAULT_RESCHEDULE_LIMIT` live, queued cards. */
export interface RescheduleSelection {
  cardIds?: readonly string[]
  itemIds?: readonly string[]
  /** Only cards whose *effective* level is one of these. */
  levels?: readonly ImportanceLevel[]
  now?: Date
  /** Cap on how many cards to load. */
  limit?: number
}

/**
 * The read half. Its repository slice carries **no write method at all**, so side-effect
 * freedom is structural rather than a promise — the strongest guarantee TypeScript offers,
 * and the reason the acceptance test's snapshot diff can only ever confirm it.
 */
export interface RescheduleReadRepositories {
  cards: Pick<CardRepository, 'findMany' | 'listByItems' | 'findDue' | 'list'>
  knowledgeItems: Pick<KnowledgeItemRepository, 'findMany'>
}

export interface SimulateRescheduleDeps {
  repos: RescheduleReadRepositories
  resolve: (input: SchedulingPolicyInput) => ImportanceResolution
  scheduler: Pick<Scheduler, 'intervalFor'>
  clock?: Clock
}

async function loadCandidates(
  deps: SimulateRescheduleDeps,
  selection: RescheduleSelection,
  now: Date,
): Promise<RescheduleCandidate[]> {
  const limit = selection.limit ?? DEFAULT_RESCHEDULE_LIMIT
  const cards =
    selection.cardIds !== undefined
      ? await deps.repos.cards.findMany(selection.cardIds)
      : selection.itemIds !== undefined
        ? await deps.repos.cards.listByItems(selection.itemIds, { limit })
        : await deps.repos.cards.list({ limit })

  const items = new Map(
    (await deps.repos.knowledgeItems.findMany([...new Set(cards.map((card) => card.itemId))])).map(
      (item): [string, KnowledgeItem] => [item.id, item],
    ),
  )

  const candidates: RescheduleCandidate[] = []
  for (const card of cards) {
    if (card.suspended) continue
    const resolution = deps.resolve({ card, item: items.get(card.itemId) ?? null, now })
    if (!resolution.queued) continue
    if (selection.levels !== undefined && !selection.levels.includes(resolution.level)) continue
    candidates.push({ card, resolution })
  }
  return candidates
}

export type SimulateReschedule = (selection?: RescheduleSelection) => Promise<RescheduleImpact>

/** "What would this cost?" — the summary the confirmation dialog shows. Writes nothing. */
export function createSimulateReschedule(deps: SimulateRescheduleDeps): SimulateReschedule {
  const clock = deps.clock ?? systemClock
  return async (selection = {}) => {
    const now = selection.now ?? clock.now()
    return projectReschedule(await loadCandidates(deps, selection, now), now, deps.scheduler)
  }
}

export interface RescheduleWriteRepositories extends RescheduleReadRepositories {
  cards: RescheduleReadRepositories['cards'] & Pick<CardRepository, 'update'>
  reviewLogs: Pick<ReviewLogRepository, 'append'>
}

export interface RescheduleUnitOfWork extends RescheduleWriteRepositories {
  transaction<T>(work: (repos: RescheduleWriteRepositories) => Promise<T> | T): Promise<T>
}

export interface RescheduleNowDeps extends Omit<SimulateRescheduleDeps, 'repos' | 'scheduler'> {
  uow: RescheduleUnitOfWork
  /** `postpone` is what moves a due date without a review: it keeps S, D, `lastReview` and
   *  the counters, and logs rating `Manual` (§7 rule 3). */
  scheduler: Pick<Scheduler, 'intervalFor' | 'postpone'>
}

/** `rating: 0` rows are excluded from the optimizer's training set, so a bulk reschedule
 *  cannot skew the parameters. `manual_postpone` is the only manual context the schema
 *  has; it covers a shortened interval too. */
const RESCHEDULE_CONTEXT: ReviewContext = 'manual_postpone'

export interface RescheduleNowInput extends RescheduleSelection {
  /** The confirmation `simulateReschedule` exists to obtain. */
  confirm: true
}

export interface RescheduleNowResult {
  impact: RescheduleImpact
  applied: number
  logs: ReviewLog[]
}

export type RescheduleNow = (input: RescheduleNowInput) => Promise<RescheduleNowResult>

/**
 * Apply the projection. One transaction: each card's `due` and `scheduled_days` move and
 * nothing else — never `stability`, `difficulty`, `last_review`, `reps` or `lapses` — and
 * one append-only `review_logs` row per card records the move.
 *
 * It **re-projects from current state** rather than replaying the summary the confirmation
 * dialog showed. A review that lands between the two is therefore respected, instead of
 * being overwritten by a due date computed from a stability that has since changed. The
 * trade-off is that the confirmed figures are a preview, not a contract: binding them would
 * need the confirmation to carry a token identifying the projection it approved.
 */
export function createRescheduleNow(deps: RescheduleNowDeps): RescheduleNow {
  const clock = deps.clock ?? systemClock

  return async (input) => {
    if (input.confirm !== true) {
      throw new RangeError('rescheduleNow: refusing to apply without an explicit confirmation')
    }
    const now = input.now ?? clock.now()
    const readDeps: SimulateRescheduleDeps = {
      repos: deps.uow,
      resolve: deps.resolve,
      scheduler: deps.scheduler,
    }
    const candidates = await loadCandidates(readDeps, input, now)
    const impact = projectReschedule(candidates, now, deps.scheduler)
    if (impact.changes.length === 0) return { impact, applied: 0, logs: [] }

    const byId = new Map(candidates.map(({ card }) => [card.id, card]))
    const moves = impact.changes.map((change) => ({
      change,
      result: deps.scheduler.postpone(byId.get(change.cardId) as Card, now, change.newDue),
      version: (byId.get(change.cardId) as Card).version,
    }))

    return deps.uow.transaction(async (repos) => {
      const logs: ReviewLog[] = []
      for (const { change, result, version } of moves) {
        await repos.cards.update(change.cardId, {
          due: result.card.due,
          // `postpone` measures `scheduledDays` from *now* — right for a user pushing a
          // card back, wrong here: the projection anchors the new due date at the last
          // review, so the interval that belongs on the card is `newDue − lastReview`.
          // The log keeps the interval that was actually in force, untouched.
          scheduledDays: change.newIntervalDays,
          version,
        })
        logs.push(
          await repos.reviewLogs.append({
            ...result.log,
            durationMs: null,
            context: RESCHEDULE_CONTEXT,
            exerciseScore: null,
            device: null,
            // No activity produced this row: it is a scheduler-side move, not an answer.
            activityType: null,
            attemptId: null,
          }),
        )
      }
      return { impact, applied: moves.length, logs }
    })
  }
}
