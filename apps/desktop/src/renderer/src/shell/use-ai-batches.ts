import type { AiBatchEvent, AiBatchSummary } from '@retenia/ipc-contract'
import type { ProcessingBatch } from '@retenia/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIpcEvent, useIpcMutation, useIpcQuery } from '../ipc/hooks'

/**
 * The tray's AI-batch rows: what has been submitted to a provider's Batch API and is still
 * being waited on (`docs/spec/06-ai-providers.md` §2).
 *
 * The same two-source shape `useProcessingJobs` has, for the same reason — `ai.listBatches`
 * says which batches exist, `ai.batchProgress` says how far along one is — with one
 * difference. A batch changes a handful of times over an hour rather than ten times a second,
 * so the push carries the **whole summary** and is merged over the query's rows directly.
 * There is no separate "live progress" overlay to reconcile, and nothing to throttle.
 */

const LIST_INPUT = {}

export interface AiBatches {
  batches: ProcessingBatch[]
  cancel: (id: string) => void
}

/** A batch in one of these has stopped; it leaves the tray on its next refresh. */
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

export function useAiBatches(): AiBatches {
  const { t } = useTranslation('shell')
  const queryClient = useQueryClient()
  const [live, setLive] = useState<Record<string, AiBatchEvent>>({})

  const { data } = useIpcQuery('ai.listBatches', LIST_INPUT)

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['ai.listBatches', LIST_INPUT] })
  }, [queryClient])

  /**
   * Stable identity: `useIpcEvent` lists the listener in its effect's dependencies, so an
   * inline arrow would unsubscribe and resubscribe on every render and drop whatever landed
   * in between.
   */
  const onProgress = useCallback(
    (event: AiBatchEvent) => {
      if (TERMINAL.has(event.status)) {
        // Drop the overlay and refetch, so the row leaves rather than freezing on its last
        // reported state.
        setLive((current) => {
          if (!(event.id in current)) return current
          const { [event.id]: _finished, ...rest } = current
          return rest
        })
        invalidate()
        return
      }
      // A batch this client has not seen is not in the cached list either; the refetch is
      // what makes its row appear at all.
      setLive((current) => {
        if (!(event.id in current)) invalidate()
        return { ...current, [event.id]: event }
      })
    },
    [invalidate],
  )

  useIpcEvent('ai.batchProgress', onProgress)

  const cancelBatch = useIpcMutation('ai.cancelBatch', { onSuccess: invalidate })

  const batches = useMemo(
    () => (data?.batches ?? []).map((batch) => toProcessingBatch(live[batch.id] ?? batch, t)),
    [data, live, t],
  )

  return { batches, cancel: (id) => cancelBatch.mutate({ id }) }
}

/**
 * `AiBatchSummary` → the tray row the sub-phase asks for:
 * **"Lote 12/40 lecciones · ~USD 1.10 · esperando"**.
 *
 * The cost is the *estimate* while the batch is running and the *actual* once it has stopped.
 * That is the honest pair: before the answers arrive there is nothing to report but the quote,
 * and afterwards the quote is no longer the interesting number. The `~` is only ever on the
 * estimate, so the two are never confused for each other.
 */
export function toProcessingBatch(
  batch: AiBatchSummary,
  t: (key: string, options?: Record<string, unknown>) => string,
): ProcessingBatch {
  const terminal = TERMINAL.has(batch.status)
  const usd = terminal ? batch.costUsd : batch.costEstimateUsd
  const cost = t(terminal ? 'aiBatches.cost' : 'aiBatches.costEstimate', {
    usd: usd.toFixed(2),
  })

  // `defaultValue` so a purpose nobody has translated yet reads as itself rather than as a
  // missing-key path — the same rule `useProcessingJobs` applies to a job kind.
  const what = t(`aiBatches.purpose.${batch.purpose}`, {
    count: batch.requestCount,
    defaultValue: batch.purpose,
  })
  const state = t(`aiBatches.status.${batch.status}`, { defaultValue: batch.status })
  const failed = batch.status === 'failed' || batch.failedCount > 0

  return {
    id: batch.id,
    label: t('aiBatches.label', {
      done: batch.succeededCount,
      total: batch.requestCount,
      what,
    }),
    detail: `${cost} · ${state}`,
    // Only once something has come back: a bar pinned at 0 % for the first half hour says
    // less than no bar at all.
    ...(batch.succeededCount === 0 || batch.requestCount === 0
      ? {}
      : { progress: Math.round((batch.succeededCount / batch.requestCount) * 100) }),
    ...(failed ? { failed: true } : {}),
    ...(batch.error === null ? {} : { error: batch.error }),
  }
}
