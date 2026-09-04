import {
  DEFAULT_IMPORTANCE_CATALOG,
  DEFAULT_SIMULATOR_CONFIG,
  type ImportanceLevel,
  relativeWorkload,
  type SimulatorConfig,
  simulate,
  workloadSummary,
} from '@retenia/core'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useIpcMutation, useIpcQuery } from '../../ipc/hooks'

/**
 * The Settings → Scheduler screen's data (`docs/spec/02-memory-system.md` §6, §7, §16).
 *
 * The workload projection is computed **here, in the renderer**, not fetched. §6's
 * simulator is pure code in `@retenia/core`, so a retention slider re-projects on every
 * drag frame with no IPC round trip — which is the whole reason that module is written in
 * TypeScript rather than reached through the optimizer's native binding.
 */

/** Small enough to stay interactive while a slider is being dragged, long enough for the
 *  workload to reach steady state. */
const SLIDER_SIM: Partial<SimulatorConfig> = {
  learnSpan: 180,
  deckSize: 1_000,
  learnLimit: 20,
}

export function useSchedulerStatus() {
  return useIpcQuery('scheduler.status', undefined)
}

export function useStartOptimization() {
  const client = useQueryClient()
  return useIpcMutation('scheduler.optimize', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['jobs.list'] })
    },
  })
}

export function useApplyOptimization() {
  const client = useQueryClient()
  return useIpcMutation('scheduler.applyOptimization', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['scheduler.status'] })
    },
  })
}

export function useUpdateProfile() {
  const client = useQueryClient()
  return useIpcMutation('scheduler.updateProfile', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['scheduler.status'] })
    },
  })
}

export function useSetLevel() {
  const client = useQueryClient()
  return useIpcMutation('scheduler.setLevel', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['scheduler.status'] })
    },
  })
}

export interface LevelWorkload {
  reviewsPerDay: number
  minutesPerDay: number
  /** Reviews relative to the 0.90 default — §7's "Urgente costará ≈ 2.5× repasos". */
  ratio: number
}

/**
 * What one retention costs, simulated against the parameters actually in force.
 *
 * Memoized on `(w, retention)` so dragging a slider re-runs one simulation per distinct
 * value rather than one per render.
 */
export function useLevelWorkload(
  w: readonly number[] | undefined,
  retention: number,
): LevelWorkload {
  const key = w?.join(',') ?? ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the value identity of `w`.
  return useMemo(() => {
    const parameters = w === undefined || w.length !== 21 ? undefined : w
    const summary = workloadSummary(simulate(parameters, retention, SLIDER_SIM))
    return {
      reviewsPerDay: summary.reviewsPerDay,
      minutesPerDay: summary.minutesPerDay,
      ratio: relativeWorkload(DEFAULT_RETENTION, retention, parameters, SLIDER_SIM),
    }
  }, [key, retention])
}

/** The baseline every level's cost is quoted against (§7's table is relative to 0.90). */
export const DEFAULT_RETENTION = 0.9

/** The five levels in review order, with the retention each currently asks for. */
export function useImportanceLevels(): ReadonlyArray<{
  level: ImportanceLevel
  desiredRetention: number | null
}> {
  return useMemo(
    () =>
      DEFAULT_IMPORTANCE_CATALOG.ordered().map((settings) => ({
        level: settings.level,
        desiredRetention: settings.desiredRetention,
      })),
    [],
  )
}

export { DEFAULT_SIMULATOR_CONFIG }
