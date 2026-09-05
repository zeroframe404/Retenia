import { createLongTextAiGrader, gradeActivity, rateResult } from '@retenia/activity-graders'
import type { Activity, GradeResult } from '@retenia/activity-schema'
import type { AiGrader, Grade, GradeMeta, PersonalPace, ReviewContext } from '@retenia/core'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { type ActivityEventHandler, activityEvent } from '../events'
import { type ActivityLabels, resolveLabels } from '../labels'
import {
  canHint as canHintOf,
  canOverrideRating as canOverrideRatingOf,
  canRetry as canRetryOf,
  canSubmit as canSubmitOf,
  createActivityReducer,
  initialActivityState,
  isLocked,
} from '../machine/reducer'
import type {
  ActivityMachineConfig,
  ActivityMode,
  ActivityOutcome,
  ActivityStatus,
} from '../machine/types'
import { allowsHints, defersFeedback } from '../machine/types'
import type { ActivityContextValue, ExplanationState } from './activity-context'
import { emptyResponse } from './empty-response'
import {
  defaultResolveMedia,
  type ExplainAnswerPort,
  type GradePort,
  type NowPort,
  noopSpeak,
  type ResolveMediaPort,
  type SpeakPort,
  staticExplainAnswer,
} from './ports'
import { listSeed, shuffleWithSeed } from './shuffle'

/** How often the timer refreshes `elapsedMs`. Four times a second is smooth enough for a
 *  countdown and cheap enough to leave running through `feedback`. */
export const TIMER_INTERVAL_MS = 250

/** Attempts allowed when `grading.maxAttempts` is absent: one, so a retry is always opt-in. */
export const DEFAULT_MAX_ATTEMPTS = 1

export interface ActivityCompletion {
  activity: Activity
  /** `null` only when the activity was skipped before any grade. */
  result: GradeResult | null
  outcome: ActivityOutcome
  attempts: number
  hintsUsed: number
  durationMs: number
}

export interface UseActivityMachineOptions {
  activity: Activity
  mode?: ActivityMode
  /** The session seed the deterministic shuffle derives from (§9). */
  seed?: string
  labels?: Partial<ActivityLabels>
  /** The user's median for this type; `toRating` needs it for the "fast"/"slow" bands. */
  personalPace?: PersonalPace
  grade?: GradePort
  explainAnswer?: ExplainAnswerPort
  speak?: SpeakPort
  resolveMedia?: ResolveMediaPort
  now?: NowPort
  onEvent?: ActivityEventHandler
  onComplete?: (completion: ActivityCompletion) => void
  /** Overrides the default (`test` mode, or an activity with a time limit). */
  showTimer?: boolean
}

/**
 * `hintPenalty` (§7) is "score fraction lost per hint", so `n` hints keep `1 − n·penalty` of the
 * measurement. Only the score moves: `correct` stays the grader's verdict, because §3's M-bin
 * already demotes a hinted correct answer to Hard through `toRating`'s `hintsUsed`, and flipping
 * the verdict here would demote it twice and log a failure the user did not commit.
 */
export function applyHintPenalty(
  result: GradeResult,
  activity: Activity,
  hintsUsed: number,
): GradeResult {
  const penalty = activity.grading.hintPenalty ?? 0
  if (penalty <= 0 || hintsUsed <= 0) return result
  const kept = Math.max(0, 1 - penalty * hintsUsed)
  return { ...result, score: Math.max(0, Math.min(1, result.score * kept)) }
}

/** The default grader: the pure family dispatch, the hint penalty, then §10's `toRating`. */
export function defaultGrade(personal: PersonalPace): GradePort {
  return (activity, response, meta) => {
    const graded = gradeActivity(activity, response, meta)
    return rateResult(applyHintPenalty(graded, activity, meta.hintsUsed), activity, personal)
  }
}

/** Whether this activity is one of §10's **AI** rows rather than a deterministic one. */
export function isAiGraded(activity: Activity): activity is Activity<'long_text'> {
  return activity.family === 'long_text' && activity.grading.method === 'ai'
}

/**
 * The `grade` port for a host that has an `AiGrader` wired: `free_recall` and `essay_rubric` go
 * to the rubric grader, everything else keeps the deterministic dispatch.
 *
 * The hint penalty is deliberately *not* applied to an AI grade. §7's `hintPenalty` docks a
 * measurement, and a rubric score is a judgement about what the learner wrote — a hint that
 * helped them write it is already visible in the text the rubric read. Docking it again would
 * discount the same help twice, and §3's M-ai has no hint clause.
 */
export function createAiGradePort(
  grader: AiGrader,
  personal: PersonalPace,
  options: { context?: ReviewContext } = {},
): GradePort {
  const longText = createLongTextAiGrader(grader, {
    personalPace: personal,
    ...(options.context === undefined ? {} : { context: options.context }),
  })
  const fallback = defaultGrade(personal)
  return (activity, response, meta) =>
    isAiGraded(activity) ? longText(activity, response, meta) : fallback(activity, response, meta)
}

function machineConfig(activity: Activity, mode: ActivityMode): ActivityMachineConfig {
  return {
    mode,
    maxAttempts: activity.grading.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    hintCount: activity.hints?.length ?? 0,
  }
}

const NO_PACE: PersonalPace = { medianMs: null }

interface ShuffleCacheEntry {
  source: readonly unknown[]
  out: readonly unknown[]
}

export function useActivityMachine(options: UseActivityMachineOptions): ActivityContextValue {
  const {
    activity,
    mode = 'study',
    seed = activity.id,
    personalPace = NO_PACE,
    explainAnswer = staticExplainAnswer,
    speak: speakPort = noopSpeak,
    resolveMedia = defaultResolveMedia,
    now = Date.now,
    onEvent,
    onComplete,
    showTimer,
  } = options

  const config = useMemo(() => machineConfig(activity, mode), [activity, mode])
  const reducer = useMemo(() => createActivityReducer(config), [config])
  const [state, dispatch] = useReducer(reducer, undefined, initialActivityState)
  const [explanation, setExplanation] = useState<ExplanationState>({ status: 'idle', text: null })

  const labels = useMemo(() => resolveLabels(options.labels), [options.labels])
  const grade = useMemo(
    () => options.grade ?? defaultGrade(personalPace),
    [options.grade, personalPace],
  )

  // The latest state, readable from the callbacks below without making them change identity on
  // every tick (which would restart the timer and re-run the effects four times a second).
  const stateRef = useRef(state)
  stateRef.current = state
  const nowRef = useRef(now)
  nowRef.current = now
  const gradeRef = useRef(grade)
  gradeRef.current = grade

  // ── the clock ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    dispatch({ type: 'PRESENT', at: nowRef.current() })
  }, [])

  const running = state.startedAt !== null && state.status !== 'completed'
  useEffect(() => {
    if (!running) return
    const id = setInterval(
      () => dispatch({ type: 'TICK', at: nowRef.current() }),
      TIMER_INTERVAL_MS,
    )
    return () => clearInterval(id)
  }, [running])

  // ── grading ──────────────────────────────────────────────────────────────────────────────
  /**
   * `answer` is for the families whose answer *is* the submit — a flashcard's self-grade button.
   * Passing it through instead of reading `stateRef` avoids the round trip where the renderer has
   * to `respond`, wait for the re-render, and only then submit.
   */
  const submit = useCallback(
    (answer?: unknown) => {
      const current = stateRef.current
      if (!canSubmitOf(current)) return
      const attempt = current.attempts + 1
      const meta: GradeMeta = {
        timeMs: Math.max(0, nowRef.current() - (current.startedAt ?? nowRef.current())),
        attempts: attempt,
        hintsUsed: current.hintsUsed,
      }
      if (answer !== undefined) dispatch({ type: 'RESPOND', response: answer })
      dispatch({ type: 'SUBMIT' })
      void (async () => {
        try {
          const response = answer ?? current.response ?? emptyResponse(activity)
          const result = await gradeRef.current(activity, response, meta)
          dispatch({ type: 'GRADED', result })
        } catch (cause) {
          dispatch({
            type: 'GRADE_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          })
        }
      })()
    },
    [activity],
  )

  // `grading.timeLimitSec` (§7): running out of time submits whatever is there, it never
  // discards the answer — "never punish the error" (docs/spec/01-decisions.md §7 rule 5).
  const timeLimitMs =
    activity.grading.timeLimitSec === undefined ? null : activity.grading.timeLimitSec * 1000
  const outOfTime = timeLimitMs !== null && state.elapsedMs >= timeLimitMs && canSubmitOf(state)
  useEffect(() => {
    if (outOfTime) submit()
  }, [outOfTime, submit])

  // ── the xAPI-like bus ────────────────────────────────────────────────────────────────────
  const emittedRef = useRef<Set<string>>(new Set())
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    const emitted = emittedRef.current
    const object = { id: activity.id, type: activity.type, family: activity.family }
    const emit = (
      key: string,
      verb: 'presented' | 'answered' | 'graded' | 'completed' | 'skipped',
      result: GradeResult | null,
    ) => {
      if (emitted.has(key)) return
      emitted.add(key)
      onEventRef.current?.(
        activityEvent({
          verb,
          object,
          result,
          elapsedMs: state.elapsedMs,
          timestamp: new Date(nowRef.current()).toISOString(),
          context: {
            skills: activity.skills,
            mode,
            attempt: state.attempts,
            hintsUsed: state.hintsUsed,
            seed,
          },
        }),
      )
    }

    if (state.status !== 'idle') emit('presented', 'presented', null)
    if (state.status === 'checking') emit(`answered:${state.attempts}`, 'answered', null)
    if (state.result !== null) emit(`graded:${state.attempts}`, 'graded', state.result)
    if (state.status === 'completed') {
      emit('final', state.outcome === 'skipped' ? 'skipped' : 'completed', state.result)
      if (!emitted.has('onComplete')) {
        emitted.add('onComplete')
        onCompleteRef.current?.({
          activity,
          result: state.result,
          outcome: state.outcome ?? 'graded',
          attempts: state.attempts,
          hintsUsed: state.hintsUsed,
          durationMs: state.elapsedMs,
        })
      }
    }
  }, [activity, mode, seed, state])

  // ── the deterministic shuffle ────────────────────────────────────────────────────────────
  const shuffleEnabled = activity.grading.shuffle !== false
  // Memoized per list so a renderer gets the *same array* back on every render (a fresh one would
  // defeat every `memo` below it). The token folds in everything the permutation depends on, so a
  // new seed or a new activity drops the cache without an effect to keep in sync.
  const cacheToken = `${seed}|${activity.id}|${shuffleEnabled}`
  const cacheRef = useRef({ token: cacheToken, lists: new Map<string, ShuffleCacheEntry>() })

  const shuffled = useCallback(
    <T>(items: readonly T[], key: string): readonly T[] => {
      if (!shuffleEnabled) return items
      if (cacheRef.current.token !== cacheToken) {
        cacheRef.current = { token: cacheToken, lists: new Map() }
      }
      const cached = cacheRef.current.lists.get(key)
      if (cached && cached.source === items) return cached.out as readonly T[]
      const out = shuffleWithSeed(items, listSeed(seed, activity.id, key))
      cacheRef.current.lists.set(key, { source: items, out })
      return out
    },
    [activity.id, cacheToken, seed, shuffleEnabled],
  )

  // ── the affordances ──────────────────────────────────────────────────────────────────────
  const respond = useCallback((response: unknown) => dispatch({ type: 'RESPOND', response }), [])
  const seedResponse = useCallback((response: unknown) => dispatch({ type: 'SEED', response }), [])
  const requestHint = useCallback(() => dispatch({ type: 'REQUEST_HINT' }), [])
  const dismissHint = useCallback(() => dispatch({ type: 'DISMISS_HINT' }), [])
  const retry = useCallback(() => dispatch({ type: 'RETRY' }), [])
  const overrideRating = useCallback(
    (rating: Grade, reason?: string) =>
      dispatch({
        type: 'OVERRIDE_RATING',
        rating,
        ...(reason === undefined || reason.trim() === '' ? {} : { reason: reason.trim() }),
        at: new Date(nowRef.current()).toISOString(),
      }),
    [],
  )
  const complete = useCallback(() => dispatch({ type: 'COMPLETE' }), [])
  const skip = useCallback(() => dispatch({ type: 'SKIP' }), [])

  const explainRef = useRef(explainAnswer)
  explainRef.current = explainAnswer
  const explain = useCallback(() => {
    const current = stateRef.current
    setExplanation({ status: 'loading', text: null })
    void explainRef
      .current({
        activity,
        response: current.response,
        result: current.result,
        lang: activity.lang,
      })
      .then((text) => setExplanation({ status: 'ready', text }))
      .catch(() => setExplanation({ status: 'error', text: null }))
  }, [activity])

  const speakRef = useRef(speakPort)
  speakRef.current = speakPort
  const speak = useCallback(
    (text: string, voice?: string) =>
      speakRef.current({ text, lang: activity.lang, ...(voice === undefined ? {} : { voice }) }),
    [activity.lang],
  )

  const revealedHints = useMemo(
    () => (activity.hints ?? []).slice(0, state.hintsUsed),
    [activity.hints, state.hintsUsed],
  )

  const secondsLeft =
    timeLimitMs === null ? null : Math.max(0, Math.ceil((timeLimitMs - state.elapsedMs) / 1000))

  const status: ActivityStatus = state.status
  return {
    activity,
    mode,
    status,
    state,
    response: state.response,
    result: state.result,
    attempts: state.attempts,
    hintsUsed: state.hintsUsed,
    revealedHints,
    elapsedMs: state.elapsedMs,
    secondsLeft,
    locked: isLocked(state),
    canSubmit: canSubmitOf(state),
    canHint: canHintOf(state, config),
    canRetry: canRetryOf(state, config),
    canOverrideRating: canOverrideRatingOf(state),
    showTimer: showTimer ?? (mode === 'test' || timeLimitMs !== null),
    deferFeedback: defersFeedback(config),
    hintsAvailable: allowsHints(config),
    error: state.error,
    seed,
    labels,
    explanation,
    canExplain: options.explainAnswer !== undefined || activity.explanation !== undefined,
    resolveMedia,
    respond,
    seedResponse,
    submit,
    requestHint,
    dismissHint,
    retry,
    overrideRating,
    complete,
    skip,
    explain,
    speak,
    shuffled,
  }
}
