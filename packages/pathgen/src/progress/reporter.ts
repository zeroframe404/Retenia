import type { Clock } from '@retenia/core'
import type { GenerationStage } from './stages'

export interface ProgressDetail {
  /** Concepts detected so far (consolidation) or in total (synthesis). */
  readonly concepts?: number
  /** The batch being awaited, when extraction went through the Batch API. */
  readonly batchId?: string
  /** Chunks answered without a call. */
  readonly cached?: number
  readonly usdSoFar?: number
}

export interface ProgressEvent {
  readonly runId: string
  readonly stage: GenerationStage
  readonly done: number
  readonly total: number
  readonly at: Date
  readonly detail?: ProgressDetail
}

export interface ProgressReporter {
  report(event: ProgressEvent): void
}

/** For a caller with no UI. */
export const silentProgress: ProgressReporter = Object.freeze({ report: () => {} })

export interface ThrottleOptions {
  readonly clock: Clock
  /** Defaults to 250 ms — four updates a second is what a progress bar can show. */
  readonly minIntervalMs?: number
}

export const DEFAULT_PROGRESS_INTERVAL_MS = 250

/**
 * Forwards at most one event per interval, except the ones that matter: the first event of
 * a stage and the last (`done === total`) always pass, so a stage never appears to be stuck
 * at 199/200 and a transition is never swallowed.
 */
export function createThrottledReporter(
  sink: ProgressReporter,
  options: ThrottleOptions,
): ProgressReporter {
  const interval = options.minIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS
  let lastStage: GenerationStage | undefined
  let lastRunId: string | undefined
  let lastAt = Number.NEGATIVE_INFINITY

  return {
    report: (event) => {
      const now = options.clock.now().getTime()
      const transition = event.stage !== lastStage || event.runId !== lastRunId
      const final = event.total > 0 && event.done >= event.total
      if (!transition && !final && now - lastAt < interval) return
      lastStage = event.stage
      lastRunId = event.runId
      lastAt = now
      sink.report(event)
    },
  }
}
