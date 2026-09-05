import type { GradeResult } from '@retenia/activity-schema'
import {
  type ActivityAction,
  type ActivityMachineConfig,
  type ActivityMachineState,
  type ActivityOutcome,
  allowsHints,
  defersFeedback,
} from './types'

/**
 * The transition table of `docs/spec/03-activities.md` §9. Pure: the host owns the clock, the
 * grader and the event bus, and feeds their outcomes in as actions.
 *
 * Anything not listed for a state is a no-op that returns the *same* object, so a stray action
 * (a late `GRADED` from an aborted round, a `RETRY` on an exhausted activity) can never move the
 * machine backwards and never re-renders the tree.
 */

export function initialActivityState(): ActivityMachineState {
  return {
    status: 'idle',
    response: null,
    attempts: 0,
    hintsUsed: 0,
    startedAt: null,
    elapsedMs: 0,
    outcome: null,
    error: null,
    result: null,
  }
}

/** Whether a wrong answer may be answered again (§2's "maximum attempts with progressive hints"). */
export function canRetry(
  state: ActivityMachineState,
  config: ActivityMachineConfig,
): state is ActivityMachineState & { status: 'feedback' } {
  return state.status === 'feedback' && !state.result.correct && state.attempts < config.maxAttempts
}

/** Whether another hint is left to reveal. */
export function canHint(state: ActivityMachineState, config: ActivityMachineConfig): boolean {
  if (!allowsHints(config)) return false
  if (state.status !== 'presenting' && state.status !== 'answering' && state.status !== 'hinting') {
    return false
  }
  return state.hintsUsed < config.hintCount
}

/**
 * Whether the rating on screen may still be corrected (§3's M-ai).
 *
 * Only while the feedback is up: once `COMPLETE` has fired, the session has taken the result
 * and written the review, and a change here would edit a number nobody is reading any more.
 */
export function canOverrideRating(state: ActivityMachineState): boolean {
  return state.status === 'feedback'
}

/** Whether the answer can be handed to the grader from here. */
export function canSubmit(state: ActivityMachineState): boolean {
  return state.status === 'presenting' || state.status === 'answering' || state.status === 'hinting'
}

/** No more input is accepted: grading is running, or the run is over. */
export function isLocked(state: ActivityMachineState): boolean {
  return !canSubmit(state)
}

function completed(state: ActivityMachineState, outcome: ActivityOutcome): ActivityMachineState {
  return { ...state, status: 'completed', outcome, result: state.result }
}

export function createActivityReducer(config: ActivityMachineConfig) {
  return function activityReducer(
    state: ActivityMachineState,
    action: ActivityAction,
  ): ActivityMachineState {
    // The clock keeps running through `checking` and `feedback` — the user is still looking at
    // the activity — but stops the moment the run is over, so `elapsedMs` is stable afterwards.
    if (action.type === 'TICK') {
      if (state.startedAt === null || state.status === 'completed') return state
      const elapsedMs = Math.max(0, action.at - state.startedAt)
      return elapsedMs === state.elapsedMs ? state : { ...state, elapsedMs }
    }

    // A seed is only ever accepted while nothing has been answered yet, so a renderer that
    // re-runs its effect cannot wipe the user's work.
    if (action.type === 'SEED') {
      return state.response === null && (state.status === 'idle' || state.status === 'presenting')
        ? { ...state, response: action.response }
        : state
    }

    if (state.status === 'completed') return state

    if (action.type === 'SKIP') {
      return completed(state, 'skipped')
    }

    switch (state.status) {
      case 'idle':
        return action.type === 'PRESENT'
          ? { ...state, status: 'presenting', startedAt: action.at, elapsedMs: 0 }
          : state

      case 'presenting':
      case 'answering':
      case 'hinting':
        switch (action.type) {
          case 'RESPOND':
            return { ...state, status: 'answering', response: action.response, error: null }
          case 'REQUEST_HINT':
            return canHint(state, config)
              ? { ...state, status: 'hinting', hintsUsed: state.hintsUsed + 1 }
              : state
          case 'DISMISS_HINT':
            return state.status === 'hinting' ? { ...state, status: 'answering' } : state
          case 'SUBMIT':
            return { ...state, status: 'checking', error: null }
          default:
            return state
        }

      case 'checking':
        switch (action.type) {
          case 'GRADED': {
            const attempts = state.attempts + 1
            // The one edge into `feedback`, and `action.result` is what makes it typecheck.
            return defersFeedback(config)
              ? {
                  ...state,
                  status: 'completed',
                  attempts,
                  outcome: 'graded',
                  result: action.result,
                }
              : { ...state, status: 'feedback', attempts, result: action.result }
          }
          case 'GRADE_FAILED':
            return { ...state, status: 'answering', error: action.message }
          default:
            return state
        }

      case 'feedback':
        switch (action.type) {
          case 'OVERRIDE_RATING': {
            // The correction is recorded *on the grade*: `meta.ratingOverride` says what the
            // grader proposed and what the learner chose, so the attempt row keeps both and
            // §17 risk 3's re-tuning has something to read. `from` is the rating as it stands
            // now, which after a second correction is the learner's own previous choice — the
            // honest answer to "what did you change".
            const result: GradeResult = {
              ...state.result,
              rating: action.rating,
              meta: {
                ...state.result.meta,
                ratingOverride: {
                  from: state.result.rating,
                  to: action.rating,
                  ...(action.reason === undefined ? {} : { reason: action.reason }),
                  at: action.at,
                },
              },
            }
            return { ...state, result }
          }
          case 'RETRY':
            return canRetry(state, config)
              ? { ...state, status: 'answering', result: null, error: null }
              : state
          case 'COMPLETE':
            return completed(state, 'graded')
          default:
            return state
        }
    }
  }
}
