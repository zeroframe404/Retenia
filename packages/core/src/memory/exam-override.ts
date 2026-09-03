import type { Card, Exam } from '../entities'
import {
  DESIRED_RETENTION_MAX,
  DESIRED_RETENTION_MIN,
  URGENT_EXAM_WINDOW_DAYS,
  URGENT_MODE_RETENTION,
} from './importance'
import { type DayBoundary, resolveDayBoundary, studyDayNumber } from './study-day'

/**
 * What a dated exam asks of one card — the seam sub-phase 10.1 fills in
 * (`docs/spec/02-memory-system.md` §8).
 *
 * §8's cap `min(I(DR_exam, S'), (E − buffer_final) − today)` is **the only intervention on
 * the scheduler**: S and D stay FSRS's, and `review_logs.scheduled_days` keeps the real
 * interval so the optimizer is never contaminated (`.claude/skills/fsrs-rules/SKILL.md`).
 *
 * This sub-phase ships the slice §7's urgent row needs — the retention rising to 0.97 in
 * the last week and the interval cap that stops a review landing after the exam. The
 * learning / consolidation / final-review phases, "ensure mastery" and catch-up are 10.1's;
 * they slot in behind the same `ExamOverrideSource` interface.
 */

/**
 * §8's `r_target`, and the schema's default for `exams.target_retention`. Used when a row
 * carries no usable number: falling back to the 0.99 ceiling instead would push the exam
 * above §7's stated 0.97 limit, "above which spaced repetition turns into massed
 * repetition".
 */
export const EXAM_TARGET_RETENTION = 0.95

export interface ExamSchedulingOverride {
  examId: string
  /** `DR_exam` — beats the importance level's retention (§7 rule 1: "the exam wins"). */
  desiredRetention: number
  /** `(E − buffer_final) − today`, in whole days, at least 1. */
  maxIntervalDays: number
  /** Whole study days from today to the exam. Negative once the exam is past. */
  daysUntilExam: number
}

export interface ExamOverrideSource {
  /** `null` when no active dated exam drives this card. */
  forCard(card: Card, now: Date): ExamSchedulingOverride | null
}

/** No exam layer at all — every card falls through to its importance level. */
export const NO_EXAM_OVERRIDES: ExamOverrideSource = Object.freeze({ forCard: () => null })

/** The exam columns the ramp reads. */
export type ExamRetentionInput = Pick<Exam, 'targetRetention' | 'finalWindowDays'>

/**
 * §7's urgent row: the exam's `target_retention` (0.95 by default) until the last week,
 * then 0.97.
 *
 * §8 describes the fuller ramp (0.92 → 0.95 over the last fortnight, → 0.97 in the last
 * three days) as part of the phase machine that owns the learning period; 10.1 replaces
 * this body with it. Everything above the last-week step is already what §8 asks for, so
 * the change will be additive.
 */
export function examDesiredRetention(daysUntilExam: number, exam: ExamRetentionInput): number {
  const target = Number.isFinite(exam.targetRetention)
    ? Math.min(Math.max(exam.targetRetention, DESIRED_RETENTION_MIN), DESIRED_RETENTION_MAX)
    : EXAM_TARGET_RETENTION
  return daysUntilExam <= URGENT_EXAM_WINDOW_DAYS ? Math.max(target, URGENT_MODE_RETENTION) : target
}

/** Whole days from `now` to the exam's ISO date, or `null` if the date is missing or
 *  unparseable. `YYYY-MM-DD` is compared at the exam's own midnight UTC. */
export function daysUntilExam(exam: Exam, now: Date, boundary: DayBoundary): number | null {
  if (exam.date === null) return null
  const at = Date.parse(`${exam.date}T00:00:00.000Z`)
  if (!Number.isFinite(at)) return null
  return Math.floor(at / 86_400_000) - studyDayNumber(now, boundary.dayStartHour, boundary.timeZone)
}

export interface ExamOverrideOptions {
  dayBoundary?: Partial<DayBoundary>
}

/**
 * What one exam asks of one card, or `null` when it asks nothing.
 *
 * Only `dated` exams with status `planned` or `active` drive scheduling: a mock exam is a
 * measurement, and a completed or archived one is history (§8's post-exam step removes the
 * override). An exam whose date has passed stops overriding for the same reason, as does
 * one the card is not attached to.
 */
export function examOverrideFor(
  card: Card,
  exam: Exam,
  now: Date,
  boundary: DayBoundary,
): ExamSchedulingOverride | null {
  if (card.examId !== exam.id) return null
  if (exam.deletedAt !== null) return null
  if (exam.kind !== 'dated') return null
  if (exam.status !== 'planned' && exam.status !== 'active') return null

  const days = daysUntilExam(exam, now, boundary)
  if (days === null || days < 0) return null

  // §8 phase 2: no review may land after the exam, so the cap is the distance to the start
  // of the final review window, never less than a day.
  const buffer = Math.max(0, Math.floor(exam.finalWindowDays))
  return {
    examId: exam.id,
    desiredRetention: examDesiredRetention(days, exam),
    maxIntervalDays: Math.max(1, days - buffer),
    daysUntilExam: days,
  }
}

/** Reads `card.examId` against the exams it is given — the session's active set, loaded
 *  once rather than per card. */
export function createExamOverrides(
  exams: readonly Exam[],
  options: ExamOverrideOptions = {},
): ExamOverrideSource {
  const boundary = resolveDayBoundary(options.dayBoundary ?? {})
  const byId = new Map(exams.map((exam) => [exam.id, exam]))

  return {
    forCard: (card, now) => {
      if (card.examId === null) return null
      const exam = byId.get(card.examId)
      return exam === undefined ? null : examOverrideFor(card, exam, now, boundary)
    },
  }
}
