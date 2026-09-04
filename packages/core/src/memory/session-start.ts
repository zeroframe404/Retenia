import type { Card, ReviewContext, ReviewLog, ReviewSession } from '../entities'
import type { CardRepository } from '../ports/card-repository'
import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import { EntityNotFoundError } from '../ports/errors'
import type { KnowledgeItemRepository } from '../ports/knowledge-item-repository'
import type { ReviewLogRepository } from '../ports/review-log-repository'
import type { ReviewSessionRepository } from '../ports/review-session-repository'
import { DEFAULT_IMPORTANCE_CATALOG, type ImportanceCatalog } from './importance'
import type { PostponeProposal } from './overload'
import type { ReviewCard } from './review-card'
import type { ImportanceResolution, SchedulingPolicyInput } from './scheduling-policy'
import { createImportanceResolver } from './scheduling-policy'
import type { SessionCardEntry, SessionEntry, SessionPlan, SessionSettings } from './session'
import type { StreakStatusProvider, XpAwarder } from './session-ports'
import {
  createSessionRunner,
  EMPTY_PROGRESS,
  type SessionPlanSnapshot,
  type SessionProgress,
  type SessionRunner,
  snapshotPlan,
  type UndoReview,
} from './session-runner'
import type { ComposeSessionQuery } from './session-service'
import { type DayBoundary, resolveDayBoundary, studyDayNumber, studyDayStart } from './study-day'
import type { Scheduler } from './types'

/**
 * Starting — or resuming — a day's session.
 *
 * This is the *apply* half of the simulate-then-confirm pair `composeSession` opens.
 * `session.plan` shows what today looks like and writes nothing; `session.start` is what
 * commits to it: it buries the siblings the plan held back (§4) and moves the cards overload
 * protection chose (§7 rule 3), then freezes the queue into `review_sessions` so closing the
 * app does not lose it.
 *
 * Resuming beats recomposing. A session left open earlier today is picked up exactly where
 * it was; recomposing would reorder the queue under someone who is halfway through it, and
 * would postpone a second time. A session left open on an *earlier* study day is abandoned
 * instead: its plan was composed against a due set that no longer exists.
 */

/** Overload postpones are rating `Manual`, like every other move that is not a review
 *  (§7 rule 3). `manual_postpone` is the context the schema has for it. */
const POSTPONE_CONTEXT: ReviewContext = 'manual_postpone'

export interface StartSessionRepositories {
  cards: Pick<CardRepository, 'findById' | 'findMany' | 'update' | 'buryUntil'>
  knowledgeItems: Pick<KnowledgeItemRepository, 'findMany'>
  reviewLogs: Pick<ReviewLogRepository, 'append' | 'findById' | 'softDeleteById'>
  reviewSessions: Pick<ReviewSessionRepository, 'create' | 'update' | 'findActive' | 'abandonStale'>
}

export interface StartSessionUnitOfWork extends StartSessionRepositories {
  transaction<T>(work: (repos: StartSessionRepositories) => Promise<T> | T): Promise<T>
}

export interface StartSessionDeps {
  uow: StartSessionUnitOfWork
  compose: ComposeSessionQuery
  reviewCard: ReviewCard
  scheduler: Pick<Scheduler, 'postpone' | 'rollback' | 'retrievability'>
  resolve?: (input: SchedulingPolicyInput) => ImportanceResolution
  catalog?: ImportanceCatalog
  xp?: XpAwarder
  streak?: StreakStatusProvider
  clock?: Clock
  dayBoundary?: Partial<DayBoundary>
}

export interface StartSessionInput {
  /** Per-session overrides — a shorter budget today, urgent mode's final drill. */
  settings?: SessionSettings
  now?: Date
  /** The plan applies burials and postponements, so it is confirmed like `rescheduleNow`. */
  confirm: true
}

export interface StartSessionResult {
  runner: SessionRunner
  session: ReviewSession
  /** The composed plan, or the rehydrated one when a session was resumed. */
  plan: SessionPlan | null
  /** Entries the runner is serving — rehydrated from the frozen snapshot when resuming. */
  entries: readonly SessionEntry[]
  resumed: boolean
  burials: number
  postponed: number
}

export type StartSession = (input: StartSessionInput) => Promise<StartSessionResult>

/**
 * Move the chosen cards, in one transaction.
 *
 * Mirrors `rescheduleNow`: `scheduler.postpone` produces the new card and its rating-`Manual`
 * log, only `due` and `scheduledDays` are written, and S, D, `lastReview`, `reps` and
 * `lapses` are left exactly as they were (`.claude/skills/fsrs-rules/SKILL.md`). Unlike
 * `rescheduleNow` the interval really is measured from now — §7 rule 3 postpones *today*
 * forward, it does not re-derive an interval from the last review.
 */
export async function applyPostponements(
  uow: StartSessionUnitOfWork,
  scheduler: Pick<Scheduler, 'postpone'>,
  proposals: readonly PostponeProposal[],
  cards: ReadonlyMap<string, Card>,
  now: Date,
): Promise<ReviewLog[]> {
  if (proposals.length === 0) return []
  const moves = proposals.flatMap((proposal) => {
    const card = cards.get(proposal.cardId)
    if (card === undefined) return []
    return [{ card, result: scheduler.postpone(card, now, proposal.newDue) }]
  })

  return uow.transaction(async (repos) => {
    const logs: ReviewLog[] = []
    for (const { card, result } of moves) {
      await repos.cards.update(card.id, {
        due: result.card.due,
        scheduledDays: result.card.scheduledDays,
        version: card.version,
      })
      logs.push(
        await repos.reviewLogs.append({
          ...result.log,
          durationMs: null,
          context: POSTPONE_CONTEXT,
          exerciseScore: null,
          device: null,
          // No activity produced this row: it is a scheduler-side move, not an answer.
          activityType: null,
          attemptId: null,
        }),
      )
    }
    return logs
  })
}

/** The undo write: roll the card back and soft-delete the row that recorded it, together. */
export function createUndoReview(deps: {
  uow: StartSessionUnitOfWork
  scheduler: Pick<Scheduler, 'rollback'>
  clock?: Clock
}): UndoReview {
  const clock = deps.clock ?? systemClock
  return async ({ cardId, logId }) => {
    const [card, log] = await Promise.all([
      deps.uow.cards.findById(cardId),
      deps.uow.reviewLogs.findById(logId),
    ])
    if (card === undefined) throw new EntityNotFoundError('cards', cardId)
    // Already undone, or never written: nothing to roll back, and saying so beats throwing.
    if (log === undefined || log.deletedAt !== null) return null

    const restored = deps.scheduler.rollback(card, log)
    return deps.uow.transaction(async (repos) => {
      const saved = await repos.cards.update(cardId, {
        due: restored.due,
        stability: restored.stability,
        difficulty: restored.difficulty,
        scheduledDays: restored.scheduledDays,
        learningSteps: restored.learningSteps,
        reps: restored.reps,
        lapses: restored.lapses,
        state: restored.state,
        lastReview: restored.lastReview,
        version: card.version,
      })
      await repos.reviewLogs.softDeleteById(logId, clock.now())
      return { card: saved }
    })
  }
}

export function createStartSession(deps: StartSessionDeps): StartSession {
  const clock = deps.clock ?? systemClock
  const catalog = deps.catalog ?? DEFAULT_IMPORTANCE_CATALOG
  const boundary = resolveDayBoundary(deps.dayBoundary)
  const resolve =
    deps.resolve ?? createImportanceResolver({ catalog, dayBoundary: deps.dayBoundary })
  const undoReview = createUndoReview({ uow: deps.uow, scheduler: deps.scheduler, clock })

  const runnerFor = (
    session: ReviewSession,
    entries: readonly SessionEntry[],
    progress: SessionProgress,
    overload: SessionPlan['overload'],
  ): SessionRunner =>
    createSessionRunner({
      session,
      entries,
      progress,
      overload,
      repos: { reviewSessions: deps.uow.reviewSessions },
      reviewCard: deps.reviewCard,
      scheduler: deps.scheduler,
      undoReview,
      cardById: (cardId) => deps.uow.cards.findById(cardId),
      resolve,
      ...(deps.xp === undefined ? {} : { xp: deps.xp }),
      ...(deps.streak === undefined ? {} : { streak: deps.streak }),
      clock,
      ...(deps.dayBoundary === undefined ? {} : { dayBoundary: deps.dayBoundary }),
    })

  return async (input) => {
    if (input.confirm !== true) {
      throw new RangeError(
        'startSession: refusing to apply a plan without an explicit confirmation',
      )
    }
    const now = input.now ?? clock.now()
    const today = studyDayNumber(now, boundary.dayStartHour, boundary.timeZone)

    // A session still open from an earlier day was composed against a due set that has
    // since moved; close it rather than resuming into it.
    await deps.uow.reviewSessions.abandonStale(
      studyDayStart(now, boundary.dayStartHour, boundary.timeZone),
    )

    const active = await deps.uow.reviewSessions.findActive()
    if (active !== undefined) {
      const snapshot = active.plan as unknown as SessionPlanSnapshot
      if (snapshot.studyDay === today) {
        const entries = await rehydrate(deps, snapshot, now, resolve)
        const progress = (active.progress as unknown as SessionProgress) ?? EMPTY_PROGRESS
        return {
          runner: runnerFor(active, entries, progress, emptyOverload(snapshot)),
          session: active,
          plan: null,
          entries,
          resumed: true,
          burials: 0,
          postponed: active.postponed,
        }
      }
    }

    const plan = await deps.compose(input.settings ?? {}, now)

    for (const burial of plan.burials) {
      await deps.uow.cards.buryUntil(burial.cardId, burial.until)
    }

    const cards = new Map<string, Card>()
    for (const entry of plan.entries) {
      if (entry.kind !== 'reinforcement') cards.set(entry.card.id, entry.card)
    }
    // Postponed cards were dropped from the queue, so their rows are not in `plan.entries`;
    // read them back to postpone them.
    if (plan.postponements.length > 0) {
      const rows = await deps.uow.cards.findMany(plan.postponements.map((p) => p.cardId))
      for (const row of rows) cards.set(row.id, row)
    }
    await applyPostponements(deps.uow, deps.scheduler, plan.postponements, cards, now)

    const session = await deps.uow.reviewSessions.create({
      status: 'in_progress',
      startedAt: now,
      finishedAt: null,
      durationMs: null,
      seed: plan.seed,
      plan: snapshotPlan(plan, boundary) as unknown as ReviewSession['plan'],
      progress: EMPTY_PROGRESS as unknown as ReviewSession['progress'],
      reviewed: 0,
      again: 0,
      hard: 0,
      postponed: plan.postponements.length,
      accuracy: null,
      xp: 0,
      summary: null,
    })

    return {
      runner: runnerFor(session, plan.entries, structuredCloneProgress(), plan.overload),
      session,
      plan,
      entries: plan.entries,
      resumed: false,
      burials: plan.burials.length,
      postponed: plan.postponements.length,
    }
  }
}

function structuredCloneProgress(): SessionProgress {
  return { cursor: 0, outcomes: [], drill: [], drillStarted: false }
}

/** A resumed session's overload figures come from the frozen snapshot: the numbers the user
 *  was shown when they started, not a fresh projection of a day they are halfway through. */
function emptyOverload(snapshot: SessionPlanSnapshot): SessionPlan['overload'] {
  const planned = snapshot.entries.length
  return {
    plannedCards: planned,
    keptCards: planned,
    postponedCards: 0,
    completedShare: 1,
    byLevel: [],
    budgetMinutes: snapshot.budgetMinutes,
    estimatedMinutes: (planned * snapshot.medianSecondsPerCard) / 60,
    overloaded: false,
    stillOverBudget: false,
  }
}

/**
 * Rebuild the runner's entries from the frozen order.
 *
 * Only the *order* was stored; the cards are read back now, so a resumed session sees their
 * current state. A card that has since been deleted or suspended simply drops out of the
 * queue — the alternative is serving a card that no longer exists.
 */
async function rehydrate(
  deps: StartSessionDeps,
  snapshot: SessionPlanSnapshot,
  now: Date,
  resolve: (input: SchedulingPolicyInput) => ImportanceResolution,
): Promise<SessionEntry[]> {
  const cardIds = snapshot.entries.flatMap((entry) => (entry.cardId === null ? [] : [entry.cardId]))
  const cards = new Map((await deps.uow.cards.findMany(cardIds)).map((card) => [card.id, card]))
  const items = new Map(
    (
      await deps.uow.knowledgeItems.findMany([...new Set([...cards.values()].map((c) => c.itemId))])
    ).map((item) => [item.id, item]),
  )

  const entries: SessionEntry[] = []
  for (const stored of snapshot.entries) {
    if (stored.kind === 'reinforcement') continue
    if (stored.cardId === null) continue
    const card = cards.get(stored.cardId)
    if (card === undefined || card.suspended) continue
    const item = items.get(card.itemId) ?? null
    const resolution = resolve({ card, item, now })
    const entry: SessionCardEntry = {
      kind: stored.kind as SessionCardEntry['kind'],
      card,
      level: resolution.level,
      options: resolution.options,
      retrievability: deps.scheduler.retrievability(card, now),
      relativeOverdueness: null,
      examId: stored.examId,
    }
    entries.push(entry)
  }
  return entries
}
