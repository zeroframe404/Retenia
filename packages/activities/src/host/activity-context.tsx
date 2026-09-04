import type {
  Activity,
  GradeResult,
  MediaRef,
  Response,
  ResponseFamily,
} from '@retenia/activity-schema'
import { createContext, useContext } from 'react'
import type { ActivityLabels } from '../labels'
import type { ActivityMachineState, ActivityMode, ActivityStatus } from '../machine/types'

/**
 * `useActivity()` of `docs/spec/03-activities.md` §9. Every renderer reads the machine and the
 * host's affordances from here instead of taking twenty props, so adding a type is "one file"
 * (§9) rather than one file plus a prop-drilling change.
 */

export type ExplanationStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ExplanationState {
  status: ExplanationStatus
  text: string | null
}

export interface ActivityContextValue {
  activity: Activity
  mode: ActivityMode
  status: ActivityStatus
  /** The whole machine state, for a renderer that needs more than the shortcuts below. */
  state: ActivityMachineState
  response: unknown
  result: GradeResult | null
  attempts: number
  hintsUsed: number
  /** The hints revealed so far, in order (`activity.hints` truncated to `hintsUsed`). */
  revealedHints: readonly string[]
  elapsedMs: number
  /** Seconds left when the activity has a `timeLimitSec`, else `null`. */
  secondsLeft: number | null
  /** No further input is accepted: grading is running, or the run is over. */
  locked: boolean
  canSubmit: boolean
  canHint: boolean
  canRetry: boolean
  /** Whether the activity offers hints at all in this mode (`test` offers none). */
  hintsAvailable: boolean
  /** `true` in `test` mode: the timer is on screen and feedback is deferred to the end. */
  showTimer: boolean
  deferFeedback: boolean
  error: string | null
  seed: string
  labels: ActivityLabels
  explanation: ExplanationState
  /** Whether the "Explain" button has anything to call: an authored `explanation`, or a tutor port. */
  canExplain: boolean

  respond: (response: unknown) => void
  /** Records the presented answer without moving the machine to `answering`. */
  seedResponse: (response: unknown) => void
  /** `answer` short-circuits the response for a family whose answer is the submit (a flashcard). */
  submit: (answer?: unknown) => void
  requestHint: () => void
  dismissHint: () => void
  retry: () => void
  complete: () => void
  skip: () => void
  explain: () => void
  speak: (text: string, voice?: string) => Promise<void>
  /** Resolves an envelope `MediaRef` to a loadable URL, or `null` when it is not available. */
  resolveMedia: (asset: MediaRef) => string | null
  /** The deterministic per-list shuffle of §9; `key` names the list inside the activity. */
  shuffled: <T>(items: readonly T[], key: string) => readonly T[]
}

const ActivityContext = createContext<ActivityContextValue | null>(null)

export const ActivityProvider = ActivityContext.Provider

export function useActivity(): ActivityContextValue {
  const value = useContext(ActivityContext)
  if (value === null) {
    throw new Error('useActivity must be used inside <ActivityHost/>')
  }
  return value
}

export interface FamilyActivityContext<F extends ResponseFamily>
  extends Omit<ActivityContextValue, 'activity' | 'response' | 'respond' | 'seedResponse'> {
  activity: Activity<F>
  response: Response<F> | null
  respond: (response: Response<F>) => void
  seedResponse: (response: Response<F>) => void
}

/**
 * The same context narrowed to one family. The cast is safe by construction: the host looks the
 * renderer up by `activity.type`, and `type ∈ family` is a parse error in `activity-schema`'s
 * envelope, so a `choice` renderer can only ever be mounted over a `choice` activity.
 */
export function useFamilyActivity<F extends ResponseFamily>(family: F): FamilyActivityContext<F> {
  const value = useActivity()
  if (value.activity.family !== family) {
    throw new Error(
      `useFamilyActivity("${family}"): the mounted activity is of family "${value.activity.family}"`,
    )
  }
  return value as unknown as FamilyActivityContext<F>
}
