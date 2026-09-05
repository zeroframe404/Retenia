import type { GradeResult } from '@retenia/activity-schema'
import type { Grade } from '@retenia/core'

/**
 * The `<ActivityHost/>` state machine of `docs/spec/03-activities.md` §9:
 *
 * ```
 * idle → presenting → answering → (hinting)* → checking → feedback → (retry | completed)
 * ```
 *
 * Modelled as a reducer rather than XState: the machine has ten actions and one async edge
 * (`checking`), and a reducer keeps the whole transition table readable in one `switch` — which
 * is what the "the machine cannot reach `feedback` without a `GradeResult`" acceptance criterion
 * needs to be provable. That criterion is enforced *structurally*, not by a runtime check: the
 * state is a discriminated union whose `feedback` branch carries a non-nullable `GradeResult`,
 * so a transition into `feedback` that has no result does not typecheck.
 */

export const ACTIVITY_STATUSES = [
  'idle',
  'presenting',
  'answering',
  'hinting',
  'checking',
  'feedback',
  'completed',
] as const
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number]

/** How the activity is being served (§12, and §5's "Legendary" policy). */
export const ACTIVITY_MODES = ['study', 'test', 'review'] as const
export type ActivityMode = (typeof ACTIVITY_MODES)[number]

/** Why the run ended: graded normally, or skipped without an answer. */
export type ActivityOutcome = 'graded' | 'skipped'

interface ActivityStateCommon {
  /** The family response as the renderer last reported it; `null` until the user acts. */
  response: unknown
  /** Graded attempts so far. `1` while the first result is on screen (§13's `attempts`). */
  attempts: number
  /** Hints revealed so far; each one costs `grading.hintPenalty` of the score. */
  hintsUsed: number
  /** Epoch ms of the `PRESENT` action, or `null` while idle. */
  startedAt: number | null
  /** Wall-clock time on the activity, in ms — what `GradeMeta.timeMs` is measured from. */
  elapsedMs: number
  outcome: ActivityOutcome | null
  /** A failed grading round (an AI grader that threw): shown, and the answer stays editable. */
  error: string | null
}

export type ActivityMachineState =
  | (ActivityStateCommon & {
      status: 'idle' | 'presenting' | 'answering' | 'hinting' | 'checking'
      result: null
    })
  | (ActivityStateCommon & { status: 'feedback'; result: GradeResult })
  | (ActivityStateCommon & { status: 'completed'; result: GradeResult | null })

export type ActivityAction =
  /** The host mounted the renderer and started the clock. */
  | { type: 'PRESENT'; at: number }
  /** The renderer reported a new answer. */
  | { type: 'RESPOND'; response: unknown }
  /**
   * The renderer's *presented* answer, before the user has touched anything — the shuffled order
   * an `ordering` activity is already in, for instance. It fills `response` without claiming the
   * user answered, so `presenting` keeps meaning "untouched" and a submit-without-input grades
   * what is actually on screen rather than an empty list.
   */
  | { type: 'SEED'; response: unknown }
  | { type: 'REQUEST_HINT' }
  | { type: 'DISMISS_HINT' }
  | { type: 'SUBMIT' }
  /** The only edge into `feedback`, and it carries the grade. */
  | { type: 'GRADED'; result: GradeResult }
  | { type: 'GRADE_FAILED'; message: string }
  /**
   * The learner corrected the rating the grader proposed — §3's M-ai ("the rubric returns a
   * rating and the user can correct it") and the self-rating an `uncertain` grade asks for.
   * It rewrites the result in place, so the completion the session receives carries the
   * rating that will actually be scheduled and the reason it changed.
   */
  | { type: 'OVERRIDE_RATING'; rating: Grade; reason?: string; at: string }
  | { type: 'RETRY' }
  | { type: 'COMPLETE' }
  | { type: 'SKIP' }
  /** The timer: `at` is epoch ms, so `elapsedMs` never drifts from the clock. */
  | { type: 'TICK'; at: number }

export interface ActivityMachineConfig {
  mode: ActivityMode
  /** `grading.maxAttempts` (§7); `1` means a wrong answer cannot be retried. */
  maxAttempts: number
  /** How many hints the activity carries. `0` disables the hint button. */
  hintCount: number
}

/**
 * `test` mode defers feedback to the end of the exam (§4 of the sub-phase brief, §12's mock
 * exams): grading still happens, but the host jumps straight to `completed` and hands the
 * result to `onComplete` for the exam layer to show later.
 */
export function defersFeedback(config: ActivityMachineConfig): boolean {
  return config.mode === 'test'
}

/** Hints are a study affordance; an exam offers none, and neither does a hint-less activity. */
export function allowsHints(config: ActivityMachineConfig): boolean {
  return config.mode !== 'test' && config.hintCount > 0
}
