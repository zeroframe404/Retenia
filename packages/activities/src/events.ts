import type { ActivityType, GradeResult } from '@retenia/activity-schema'
import type { ActivityFamily } from '@retenia/core'
import type { ActivityMode } from './machine/types'

/**
 * The xAPI-like bus of `docs/spec/03-activities.md` §9: `activity.presented / answered / graded /
 * completed / skipped`, each with `verb`, `object.id`, `result.score / success / duration` and
 * `context.skills`.
 *
 * The shape deliberately mirrors an xAPI statement without pretending to be one (no actor, no
 * IRIs): §9's stated reason for it is that "it makes it trivial to map H5P events onto the same
 * bus" in phase 3, and `h5p-bridge` will translate real xAPI statements into these.
 */

export const ACTIVITY_VERBS = ['presented', 'answered', 'graded', 'completed', 'skipped'] as const
export type ActivityVerb = (typeof ACTIVITY_VERBS)[number]

export type ActivityEventName = `activity.${ActivityVerb}`

export interface ActivityEventObject {
  id: string
  type: ActivityType
  family: ActivityFamily
}

export interface ActivityEventResult {
  /** `0..1`, the grader's measurement. */
  score: number
  /** xAPI's `result.success`: the grader's verdict. */
  success: boolean
  /** xAPI's `result.duration`: an ISO-8601 duration, e.g. `PT12.34S`. */
  duration: string
}

export interface ActivityEventContext {
  /** The concepts the scheduler schedules (§5: "the scheduler schedules skills"). */
  skills: readonly string[]
  mode: ActivityMode
  /** Which try this event belongs to; `0` before the first grade. */
  attempt: number
  hintsUsed: number
  /** The session seed the deterministic shuffle was derived from. */
  seed: string
}

export interface ActivityEvent {
  name: ActivityEventName
  verb: ActivityVerb
  object: ActivityEventObject
  result?: ActivityEventResult
  context: ActivityEventContext
  timestamp: string
}

export type ActivityEventHandler = (event: ActivityEvent) => void

/** Milliseconds as an ISO-8601 duration, the format xAPI's `result.duration` requires. */
export function isoDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000
  // Two decimals is the resolution xAPI recommends; `parseFloat` drops the trailing zeros.
  return `PT${Number.parseFloat(seconds.toFixed(2))}S`
}

export interface ActivityEventInput {
  verb: ActivityVerb
  object: ActivityEventObject
  context: ActivityEventContext
  result?: GradeResult | null
  /** Time on the activity when the event fired, in ms. */
  elapsedMs: number
  /** Injected so tests and replays are deterministic. */
  timestamp: string
}

export function activityEvent(input: ActivityEventInput): ActivityEvent {
  const { verb, object, context, result, elapsedMs, timestamp } = input
  return {
    name: `activity.${verb}`,
    verb,
    object,
    ...(result
      ? {
          result: {
            score: result.score,
            success: result.correct,
            duration: isoDuration(elapsedMs),
          },
        }
      : {}),
    context,
    timestamp,
  }
}
