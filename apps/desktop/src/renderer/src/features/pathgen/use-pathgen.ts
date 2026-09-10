import type { GenerationConfigInputDto, PathEditOpDto } from '@retenia/ipc-contract'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useIpcEvent, useIpcMutation, useIpcQuery } from '../../ipc/hooks'

/**
 * "Generate with AI" (sub-phase 8.2, `docs/spec/04-path-generation.md` §13 steps 1–3 and 6):
 * the wizard's live estimate and run lifecycle, the editable preview's draft, and freezing a
 * version.
 */

export function useQuote() {
  return useIpcMutation('pathgen.quote')
}

export function useStartGeneration() {
  return useIpcMutation('pathgen.start')
}

export function useResumeGeneration() {
  return useIpcMutation('pathgen.resume')
}

export function useCancelGeneration() {
  return useIpcMutation('pathgen.cancel')
}

export function useGenerationRun(runId: string | undefined) {
  return useIpcQuery('pathgen.getRun', { runId: runId ?? '' }, { enabled: runId !== undefined })
}

/** Live stage/progress for one run, updated by `pathgen.progress` pushes and seeded from
 *  `pathgen.getRun` so reopening the app mid-run still shows the last known stage. */
export function useGenerationProgress(runId: string | undefined) {
  const run = useGenerationRun(runId)
  const [live, setLive] = useState<{ stage: string; done: number; total: number } | null>(null)

  useIpcEvent(
    'pathgen.progress',
    useCallback(
      (event) => {
        if (event.runId !== runId) return
        setLive({ stage: event.stage, done: event.done, total: event.total })
      },
      [runId],
    ),
  )

  if (live !== null) return live
  const progress = run.data?.run?.progress
  return progress ? { stage: progress.stage, done: progress.done, total: progress.total } : null
}

const VERSION_KEY = (pathVersionId: string) => ['pathgen.getVersion', { pathVersionId }]

export function usePathVersion(pathVersionId: string | undefined) {
  return useIpcQuery(
    'pathgen.getVersion',
    { pathVersionId: pathVersionId ?? '' },
    { enabled: pathVersionId !== undefined },
  )
}

export function useEditDraft(pathVersionId: string) {
  const client = useQueryClient()
  return useIpcMutation('pathgen.editDraft', {
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: VERSION_KEY(pathVersionId) })
    },
  })
}

export function useFreeze() {
  const client = useQueryClient()
  return useIpcMutation('pathgen.freeze', {
    onSuccess: (_data, { pathVersionId }) => {
      void client.invalidateQueries({ queryKey: VERSION_KEY(pathVersionId) })
    },
  })
}

export type { GenerationConfigInputDto, PathEditOpDto }
