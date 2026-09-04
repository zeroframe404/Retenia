import type { Contract, InferOutput } from '@retenia/ipc-contract'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useIpcMutation } from '../../ipc/hooks'

/**
 * The review session state machine, driven entirely by `session.*` (`docs/spec/
 * 02-memory-system.md` §12). The daily composer, the FSRS scheduler and the queue itself
 * all live in main (`packages/core/src/memory/session-runner.ts`); this hook only mirrors
 * `SessionRunner`'s shape on the renderer side — `next`/`answer`/`skip`/`undo`/`finish` —
 * and holds the one entry the screen is currently showing.
 *
 * Mounted once by `ReviewScreen`, which stays mounted via `<Activity>` while the user
 * navigates elsewhere (`shell/sticky-outlet.tsx`): `phase` starts `'idle'` and only ever
 * reaches `'active'`/`'finished'` once, so a re-run of the mount effect after an
 * Activity hide/show transition is a no-op rather than a restart.
 */

export type ReviewGrade = 1 | 2 | 3 | 4

type NextResult = InferOutput<Contract, 'session.next'>
export type ReviewEntryDto = NonNullable<NextResult['entry']>
export type ReviewItemDto = NextResult['item']
export type ReviewPreviewDto = NextResult['preview']
export type ReviewProgressDto = NextResult['progress']
export type ReviewSummaryDto = InferOutput<Contract, 'session.finish'>

export type ReviewPhase = 'idle' | 'starting' | 'active' | 'finished' | 'error'

export interface ReviewSessionState {
  phase: ReviewPhase
  entry: ReviewEntryDto | null
  item: ReviewItemDto
  preview: ReviewPreviewDto
  progress: ReviewProgressDto | null
  summary: ReviewSummaryDto | null
  resumed: boolean
  burials: number
  postponed: number
  busy: boolean
  error: string | null
}

export interface UseReviewSessionResult extends ReviewSessionState {
  start: () => Promise<void>
  answer: (grade: ReviewGrade) => Promise<void>
  skip: () => Promise<void>
  undo: () => Promise<void>
  /** Starts a brand new session after `'finished'` — "Seguir repasando" on the summary. */
  reviewMore: () => Promise<void>
}

const INITIAL_STATE: ReviewSessionState = {
  phase: 'idle',
  entry: null,
  item: null,
  preview: null,
  progress: null,
  summary: null,
  resumed: false,
  burials: 0,
  postponed: 0,
  busy: false,
  error: null,
}

export function useReviewSession(): UseReviewSessionResult {
  const [state, setState] = useState<ReviewSessionState>(INITIAL_STATE)

  const startMutation = useIpcMutation('session.start')
  const nextMutation = useIpcMutation('session.next')
  const answerMutation = useIpcMutation('session.answer')
  const skipMutation = useIpcMutation('session.skip')
  const undoMutation = useIpcMutation('session.undo')
  const finishMutation = useIpcMutation('session.finish')

  // Guards against the mount effect firing again (Activity hide/show re-runs effects) while
  // a `start()` from the first run is still in flight.
  const startInFlight = useRef(false)

  const advance = useCallback(async () => {
    const next = await nextMutation.mutateAsync(undefined)
    // `entry === null` is `SessionRunner.next()`'s own "the queue — drill included — is
    // exhausted" signal (`packages/core/src/memory/session-runner.ts`), true the moment
    // there was nothing to review at all, not only after grading the last card. Checking
    // `progress.finished` instead would never fire for an empty session: that flag only
    // flips once `session.finish()` has actually run.
    if (next.entry === null) {
      const summary = await finishMutation.mutateAsync(undefined)
      setState((current) => ({
        ...current,
        phase: 'finished',
        entry: null,
        item: null,
        preview: null,
        progress: next.progress,
        summary,
        busy: false,
      }))
      return
    }
    setState((current) => ({
      ...current,
      phase: 'active',
      entry: next.entry,
      item: next.item,
      preview: next.preview,
      progress: next.progress,
      busy: false,
    }))
  }, [nextMutation, finishMutation])

  const start = useCallback(async () => {
    if (startInFlight.current) return
    startInFlight.current = true
    setState((current) => ({ ...current, phase: 'starting', busy: true, error: null }))
    try {
      const result = await startMutation.mutateAsync({ confirm: true })
      setState((current) => ({
        ...current,
        resumed: result.resumed,
        burials: result.burials,
        postponed: result.postponed,
      }))
      await advance()
    } catch (error) {
      setState((current) => ({
        ...current,
        phase: 'error',
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      startInFlight.current = false
    }
  }, [startMutation, advance])

  const answer = useCallback(
    async (grade: ReviewGrade) => {
      setState((current) => ({ ...current, busy: true }))
      await answerMutation.mutateAsync({ rating: grade })
      await advance()
    },
    [answerMutation, advance],
  )

  const skip = useCallback(async () => {
    setState((current) => ({ ...current, busy: true }))
    await skipMutation.mutateAsync(undefined)
    await advance()
  }, [skipMutation, advance])

  const undo = useCallback(async () => {
    setState((current) => ({ ...current, busy: true }))
    await undoMutation.mutateAsync(undefined)
    await advance()
  }, [undoMutation, advance])

  const reviewMore = useCallback(async () => {
    setState(INITIAL_STATE)
    startInFlight.current = false
    await start()
  }, [start])

  // Runs on mount and again on every Activity show/hide transition — `phase === 'idle'`
  // only holds before the very first successful `start()`, so subsequent re-runs are a
  // no-op (see the module doc).
  useEffect(() => {
    if (state.phase === 'idle') void start()
  }, [state.phase, start])

  return { ...state, start, answer, skip, undo, reviewMore }
}
