import type { Card, ImportanceLevel, JsonObject, Rating, ReviewSession } from '../entities'
import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import type { ReviewSessionRepository } from '../ports/review-session-repository'
import type { OverloadSummary } from './overload'
import type { ReviewCard } from './review-card'
import type { ImportanceResolution, SchedulingPolicyInput } from './scheduling-policy'
import type { SessionCardEntry, SessionEntry, SessionEntryKind, SessionPlan } from './session'
import type { SessionEffort, StreakStatus, StreakStatusProvider, XpAwarder } from './session-ports'
import { NO_STREAK, NO_XP } from './session-ports'
import type { DayBoundary } from './study-day'
import { studyDayNumber } from './study-day'
import type { Grade, Scheduler } from './types'
import { RATING } from './types'

/**
 * The session runtime (`docs/spec/02-memory-system.md` §12): a state machine over the plan
 * that survives the app being closed.
 *
 * Every mutation writes twice — once through `reviewCard`, which owns the card and the
 * `review_logs` row, and once to `review_sessions`, which owns only *where in the queue the
 * user is*. The scheduler's state is never duplicated into the session row: delete
 * `review_sessions` and nothing about memory is lost, only the ability to resume.
 *
 * `undo` is the one place that touches a written review, and it does the only thing the
 * append-only rule permits — soft-delete the row, leaving `updated_at` and `version` alone —
 * while `Scheduler.rollback` puts the card back exactly as it was
 * (`.claude/skills/fsrs-rules/SKILL.md`).
 */

// --- what gets persisted -----------------------------------------------------------------

/**
 * The plan as stored. Deliberately *not* the plan itself: a 2,000-card plan holds 2,000 full
 * cards, and rewriting that JSON after every answer would cost more than the review does.
 * Only the order is frozen here; the cards are read back from `cards` on resume, which is
 * also what makes a resumed session see their current state rather than a stale copy.
 */
export type SessionPlanSnapshotEntry = {
  kind: SessionEntryKind
  cardId: string | null
  nodeId: string | null
  level: ImportanceLevel | null
  examId: string | null
}

export type SessionPlanSnapshot = {
  entries: SessionPlanSnapshotEntry[]
  order: string
  finalDrill: boolean
  budgetMinutes: number
  streakGoalCards: number
  medianSecondsPerCard: number
  backlogDays: number
  newGated: boolean
  composedAt: string
  studyDay: number
}

/** One thing the user did, in order. `logId` is `null` for a skip — nothing was written. */
export type SessionOutcome = {
  cardId: string
  rating: Rating | null
  logId: string | null
  durationMs: number | null
  at: string
}

export type SessionProgress = {
  cursor: number
  outcomes: SessionOutcome[]
  /** Cards graded Again or Hard, in order — §12 step 6's final drill queue. */
  drill: string[]
  /** The main queue is done and the drill entries are being served. */
  drillStarted: boolean
}

export function snapshotPlan(plan: SessionPlan, boundary: DayBoundary): SessionPlanSnapshot {
  return {
    entries: plan.entries.map((entry) =>
      entry.kind === 'reinforcement'
        ? { kind: entry.kind, cardId: null, nodeId: entry.node.id, level: null, examId: null }
        : {
            kind: entry.kind,
            cardId: entry.card.id,
            nodeId: null,
            level: entry.level,
            examId: entry.examId,
          },
    ),
    order: plan.order,
    finalDrill: plan.finalDrill,
    budgetMinutes: plan.budgetMinutes,
    streakGoalCards: plan.streakGoalCards,
    medianSecondsPerCard: plan.medianSecondsPerCard,
    backlogDays: plan.backlogDays,
    newGated: plan.newGated,
    composedAt: plan.composedAt.toISOString(),
    studyDay: studyDayNumber(plan.composedAt, boundary.dayStartHour, boundary.timeZone),
  }
}

export const EMPTY_PROGRESS: SessionProgress = Object.freeze({
  cursor: 0,
  outcomes: [],
  drill: [],
  drillStarted: false,
}) as SessionProgress

// --- the runner --------------------------------------------------------------------------

export type SessionAnswerInput =
  | Grade
  | {
      rating: Grade
      /** The grader's continuous score, when a graded exercise produced the rating. The
       *  §10 mapping from an exercise result to a rating is sub-phase 4.5's; this takes the
       *  rating it produced. */
      exerciseScore?: number | null
      /** Overrides the runner's own timer — a host that measured it more precisely. */
      durationMs?: number | null
      attemptId?: string | null
    }

export interface SessionAnswerResult {
  card: Card
  logId: string
  rating: Grade
  /** Queued for the final drill because it was graded Again or Hard. */
  drilled: boolean
  remaining: number
}

export interface SessionUndoResult {
  card: Card
  /** The log that was soft-deleted. */
  logId: string
  cardId: string
}

export interface SessionSummary {
  sessionId: string
  reviewed: number
  again: number
  hard: number
  skipped: number
  /** Correct over graded — an `Again` is the only thing counted wrong (§13, true retention). */
  accuracy: number | null
  minutes: number
  xp: number
  /** How many cards overload protection moved when the session started. */
  postponed: number
  streak: StreakStatus
  overload: OverloadSummary
  finishedAt: Date
}

export interface SessionRunnerState {
  sessionId: string
  cursor: number
  total: number
  remaining: number
  reviewed: number
  again: number
  hard: number
  skipped: number
  drillPending: number
  drillStarted: boolean
  finished: boolean
}

export interface SessionRunner {
  readonly sessionId: string
  /** The entry the user is on, or `null` when the queue — drill included — is exhausted.
   *  Pure: it starts the per-card timer but writes nothing. */
  next(): SessionEntry | null
  answer(input: SessionAnswerInput): Promise<SessionAnswerResult>
  /** Move past the current entry without recording anything. */
  skip(): Promise<void>
  /** Undo the last answer. Returns `null` when there is nothing to undo. */
  undo(): Promise<SessionUndoResult | null>
  finish(): Promise<SessionSummary>
  state(): SessionRunnerState
}

export interface SessionRunnerRepositories {
  reviewSessions: Pick<ReviewSessionRepository, 'update'>
}

export interface SessionRunnerDeps {
  session: ReviewSession
  entries: readonly SessionEntry[]
  progress: SessionProgress
  overload: OverloadSummary
  repos: SessionRunnerRepositories
  reviewCard: ReviewCard
  scheduler: Pick<Scheduler, 'rollback'>
  /** Rolls a card back and soft-deletes its log, in one transaction. */
  undoReview: UndoReview
  /** Looks a card up by id — the drill re-serves cards by id, and a card may have moved. */
  cardById: (cardId: string) => Promise<Card | undefined>
  resolve?: (input: SchedulingPolicyInput) => ImportanceResolution
  xp?: XpAwarder
  streak?: StreakStatusProvider
  clock?: Clock
  dayBoundary?: Partial<DayBoundary>
}

/** The undo write, injected so the runner does not need a unit of work of its own. */
export type UndoReview = (input: {
  cardId: string
  logId: string
}) => Promise<{ card: Card } | null>

function normalizeAnswer(input: SessionAnswerInput): {
  rating: Grade
  exerciseScore: number | null
  durationMs: number | null
  attemptId: string | null
} {
  if (typeof input === 'number') {
    return { rating: input, exerciseScore: null, durationMs: null, attemptId: null }
  }
  return {
    rating: input.rating,
    exerciseScore: input.exerciseScore ?? null,
    durationMs: input.durationMs ?? null,
    attemptId: input.attemptId ?? null,
  }
}

export function createSessionRunner(deps: SessionRunnerDeps): SessionRunner {
  const clock = deps.clock ?? systemClock
  const xp = deps.xp ?? NO_XP
  const streak = deps.streak ?? NO_STREAK
  const entries = deps.entries
  const progress: SessionProgress = {
    cursor: deps.progress.cursor,
    outcomes: [...deps.progress.outcomes],
    drill: [...deps.progress.drill],
    drillStarted: deps.progress.drillStarted,
  }
  const snapshot = deps.session.plan as unknown as SessionPlanSnapshot
  const finalDrill = snapshot.finalDrill === true

  let startedAt: number | null = null
  /** The drill entry currently being served, so `answer` knows what it is grading. */
  let drillEntry: SessionCardEntry | null = null
  let finished = deps.session.status !== 'in_progress'

  const graded = (): SessionOutcome[] => progress.outcomes.filter((o) => o.logId !== null)
  const counts = () => {
    let again = 0
    let hard = 0
    let skipped = 0
    for (const outcome of progress.outcomes) {
      if (outcome.logId === null) skipped += 1
      else if (outcome.rating === RATING.Again) again += 1
      else if (outcome.rating === RATING.Hard) hard += 1
    }
    return { again, hard, skipped }
  }

  function currentEntry(): SessionEntry | null {
    if (progress.cursor < entries.length) return entries[progress.cursor] as SessionEntry
    return drillEntry
  }

  async function persist(patch: Partial<ReviewSession> = {}): Promise<void> {
    const { again, hard } = counts()
    const reviewed = graded().length
    await deps.repos.reviewSessions.update(deps.session.id, {
      progress: progress as unknown as JsonObject,
      reviewed,
      again,
      hard,
      accuracy: reviewed === 0 ? null : (reviewed - again) / reviewed,
      ...patch,
    })
  }

  /** Pull the next drill card, skipping ones that no longer exist. */
  async function loadDrillEntry(): Promise<SessionCardEntry | null> {
    while (progress.drill.length > 0) {
      const cardId = progress.drill.shift() as string
      const card = await deps.cardById(cardId)
      if (card === undefined) continue
      const previous = entries.find(
        (entry): entry is SessionCardEntry =>
          entry.kind !== 'reinforcement' && entry.card.id === cardId,
      )
      if (previous === undefined) continue
      return { ...previous, card }
    }
    return null
  }

  return {
    sessionId: deps.session.id,

    next() {
      const entry = currentEntry()
      if (entry !== null && startedAt === null) startedAt = clock.now().getTime()
      return entry
    },

    async answer(input) {
      const entry = currentEntry()
      if (entry === null) throw new RangeError('session: the queue is exhausted')
      if (entry.kind === 'reinforcement') {
        throw new TypeError('session: a reinforcement node is not answered with a rating')
      }
      const { rating, exerciseScore, durationMs, attemptId } = normalizeAnswer(input)
      if (rating !== 1 && rating !== 2 && rating !== 3 && rating !== 4) {
        throw new RangeError(`session: rating must be 1 (Again) … 4 (Easy), got ${String(rating)}`)
      }
      const now = clock.now()
      const measured =
        durationMs ?? (startedAt === null ? null : Math.max(0, now.getTime() - startedAt))

      const result = await deps.reviewCard({
        cardId: entry.card.id,
        now,
        rating,
        durationMs: measured,
        context: entry.kind === 'exam' ? 'exam_sim' : 'daily',
        exerciseScore,
        attemptId,
      })

      const drilled = finalDrill && (rating === RATING.Again || rating === RATING.Hard)
      if (drilled && drillEntry === null) progress.drill.push(entry.card.id)

      progress.outcomes.push({
        cardId: entry.card.id,
        rating,
        logId: result.log.id,
        durationMs: measured,
        at: now.toISOString(),
      })
      if (drillEntry === null) progress.cursor += 1
      else drillEntry = null
      startedAt = null

      await persist()
      if (progress.cursor >= entries.length && drillEntry === null) {
        drillEntry = await loadDrillEntry()
        if (drillEntry !== null) progress.drillStarted = true
      }
      return {
        card: result.card,
        logId: result.log.id,
        rating,
        drilled,
        remaining: entries.length - progress.cursor + progress.drill.length,
      }
    },

    async skip() {
      const entry = currentEntry()
      if (entry === null) return
      if (entry.kind !== 'reinforcement') {
        progress.outcomes.push({
          cardId: entry.card.id,
          rating: null,
          logId: null,
          durationMs: null,
          at: clock.now().toISOString(),
        })
      }
      if (drillEntry === null) progress.cursor += 1
      else drillEntry = null
      startedAt = null
      await persist()
      if (progress.cursor >= entries.length && drillEntry === null) {
        drillEntry = await loadDrillEntry()
        if (drillEntry !== null) progress.drillStarted = true
      }
    },

    async undo() {
      // Walk back over skips: they wrote nothing, so undoing them is just moving the cursor.
      let last = progress.outcomes[progress.outcomes.length - 1]
      while (last !== undefined && last.logId === null) {
        progress.outcomes.pop()
        progress.cursor = Math.max(0, progress.cursor - 1)
        last = progress.outcomes[progress.outcomes.length - 1]
      }
      if (last === undefined) {
        await persist()
        return null
      }

      const undone = await deps.undoReview({ cardId: last.cardId, logId: last.logId as string })
      progress.outcomes.pop()
      progress.cursor = Math.max(0, progress.cursor - 1)
      // The answer that queued it for the drill is gone, so the drill entry goes with it.
      const drillAt = progress.drill.lastIndexOf(last.cardId)
      if (drillAt !== -1) progress.drill.splice(drillAt, 1)
      drillEntry = null
      startedAt = null
      await persist()
      if (undone === null) return null
      return { card: undone.card, logId: last.logId as string, cardId: last.cardId }
    },

    async finish() {
      const now = clock.now()
      const { again, hard, skipped } = counts()
      const done = graded()
      const reviewed = done.length
      const accuracy = reviewed === 0 ? null : (reviewed - again) / reviewed
      const minutes = done.reduce((total, outcome) => total + (outcome.durationMs ?? 0), 0) / 60_000
      const effort: SessionEffort = { reviewed, accuracy, minutes }

      const [earned, streakStatus] = await Promise.all([
        xp.award(effort),
        streak.status(effort, snapshot.streakGoalCards),
      ])

      const summary: SessionSummary = {
        sessionId: deps.session.id,
        reviewed,
        again,
        hard,
        skipped,
        accuracy,
        minutes,
        xp: earned,
        postponed: deps.session.postponed,
        streak: streakStatus,
        overload: deps.overload,
        finishedAt: now,
      }
      finished = true
      await persist({
        status: 'completed',
        finishedAt: now,
        durationMs: Math.max(0, now.getTime() - deps.session.startedAt.getTime()),
        xp: earned,
        summary: {
          reviewed,
          again,
          hard,
          skipped,
          accuracy,
          minutes,
          xp: earned,
          postponed: deps.session.postponed,
        } as unknown as JsonObject,
      })
      return summary
    },

    state() {
      const { again, hard, skipped } = counts()
      return {
        sessionId: deps.session.id,
        cursor: progress.cursor,
        total: entries.length,
        remaining: Math.max(0, entries.length - progress.cursor) + progress.drill.length,
        reviewed: graded().length,
        again,
        hard,
        skipped,
        drillPending: progress.drill.length,
        drillStarted: progress.drillStarted,
        finished,
      }
    },
  }
}
