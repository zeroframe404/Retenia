import type { Card, ImportanceLevel } from '../entities'
import type { SchedulingOptions } from './types'

/**
 * The seams the daily session composer leaves for sub-phases that have not landed yet
 * (`docs/spec/02-memory-system.md` §12 steps 1 and 5, and §13's XP and streak).
 *
 * Each is a port with a **working default**, not a stub that throws: composing a session
 * today must produce a real plan even though exams (10.1), path reinforcement (9.3) and
 * gamification (13.1) do not exist. The default is the honest empty answer — no exam queue,
 * no node due, no XP, no streak — so the composer's own logic is exercised end to end and
 * nothing here needs revisiting when the real implementations arrive.
 *
 * They are async because the real ones will read the database; the *pure* `composeSession`
 * takes their already-resolved results, so it stays synchronous.
 */

// --- §12 step 1: active exams ------------------------------------------------------------

/** One card an exam is driving, with the two keys §8 phase 3 orders its final window by. */
export interface ExamQueueEntry {
  card: Card
  examId: string
  /**
   * The card's effective level and the options the exam resolved for it. The exam wins over
   * importance (§7 rule 1), so the provider — which is the only thing that knows the exam —
   * resolves these; the composer must not second-guess them.
   */
  level: ImportanceLevel
  options: SchedulingOptions
  /** `R` at the exam date. The queue's primary key, **ascending** — weakest first. */
  examRetrievability: number
  /**
   * The card's topic weight in the exam blueprint, in `[0, 1]`; `0` when the exam has no
   * blueprint. Breaks ties **descending**: a heavier topic is asked first.
   */
  topicWeight: number
}

export interface ExamQueueProvider {
  /** Every card the active exams want today, in no particular order — the composer sorts. */
  queueFor(now: Date): Promise<readonly ExamQueueEntry[]>
}

/** No exams. The default until sub-phase 10.1 builds the exam scheduler. */
export const NO_EXAM_QUEUE: ExamQueueProvider = Object.freeze({
  queueFor: () => Promise.resolve([] as readonly ExamQueueEntry[]),
})

// --- §12 step 5: the path's reinforcement node -------------------------------------------

/** §11 rule 4: the node the path inserts every 3–5 lessons. */
export interface ReinforcementNode {
  id: string
  lessonId: string | null
  pathId: string | null
  /** How long it is expected to take, so it can be charged against the budget. */
  estimatedMinutes: number
}

export interface ReinforcementProvider {
  /** The node due today, or `null`. At most one per session (§5, "at most 1 active per
   *  module"). */
  dueToday(now: Date): Promise<ReinforcementNode | null>
}

/** No node ever due. The default until sub-phase 9.3 wires the path. */
export const NO_REINFORCEMENT: ReinforcementProvider = Object.freeze({
  dueToday: () => Promise.resolve(null),
})

// --- §13: what the finish summary shows --------------------------------------------------

export interface SessionEffort {
  reviewed: number
  /** Correct over graded, in `[0, 1]`; `null` when nothing was graded. */
  accuracy: number | null
  minutes: number
}

export interface XpAwarder {
  /** XP earned by a finished session. Awarding is the implementation's business. */
  award(effort: SessionEffort): Promise<number>
}

/** No XP. The default until sub-phase 13.1 builds gamification. */
export const NO_XP: XpAwarder = Object.freeze({ award: () => Promise.resolve(0) })

/**
 * Where the streak stands after this session. `unknown` is what the default returns — the
 * UI shows nothing rather than a wrong "0 days".
 */
export type StreakState = 'unknown' | 'at_risk' | 'kept' | 'extended'

export interface StreakStatus {
  state: StreakState
  /** Consecutive days including today, or `0` when unknown. */
  current: number
  /** §12: the minimum not to break the streak — 10 cards by default. */
  goalCards: number
  reviewedToday: number
  /** `reviewedToday >= goalCards`. */
  goalMet: boolean
}

export interface StreakStatusProvider {
  status(effort: SessionEffort, goalCards: number): Promise<StreakStatus>
}

/** Reports only what the session itself knows: whether the streak goal was met. Everything
 *  that needs history stays `unknown` until sub-phase 13.1. */
export const NO_STREAK: StreakStatusProvider = Object.freeze({
  status: (effort: SessionEffort, goalCards: number) =>
    Promise.resolve({
      state: 'unknown' as StreakState,
      current: 0,
      goalCards,
      reviewedToday: effort.reviewed,
      goalMet: effort.reviewed >= goalCards,
    }),
})
