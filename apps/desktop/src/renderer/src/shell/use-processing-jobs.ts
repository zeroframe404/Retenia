import type { JobProgressEvent, JobStatus, JobSummary } from '@retenia/ipc-contract'
import type { ProcessingJob } from '@retenia/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIpcEvent, useIpcMutation, useIpcQuery } from '../ipc/hooks'

/**
 * The processing tray's data: the persisted queue, with live progress laid over it.
 *
 * Two sources, because neither alone is enough. `jobs.list` is the truth about *which* jobs
 * exist but is only as fresh as its last fetch; `jobs.progress` is a 10 Hz push that says how
 * far along a job is but never enumerates. So the query supplies the rows and the event
 * supplies the bar, and a terminal status on the event invalidates the query — which is how a
 * finished job leaves the tray without polling for it.
 */

/** The statuses the tray shows. `succeeded` and `cancelled` rows drop out on their own. */
const TRAY_STATUSES: JobStatus[] = ['queued', 'running', 'failed']

const LIST_INPUT = { statuses: TRAY_STATUSES }

interface LiveProgress {
  progress: number | null
  message: string | null
}

export interface ProcessingJobs {
  jobs: ProcessingJob[]
  cancel: (id: string) => void
  retry: (id: string) => void
}

export function useProcessingJobs(): ProcessingJobs {
  const { t } = useTranslation('shell')
  const queryClient = useQueryClient()
  const [live, setLive] = useState<Record<string, LiveProgress>>({})
  /** Job ids we have already refetched the list for. */
  const seen = useRef<Set<string>>(new Set())

  const { data } = useIpcQuery('jobs.list', LIST_INPUT)

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['jobs.list', LIST_INPUT] })
  }, [queryClient])

  /**
   * `useCallback` with stable deps is load-bearing: `useIpcEvent` lists the listener in its
   * effect's dependencies, so an inline arrow would unsubscribe and resubscribe on every
   * render — dropping any push that landed in between.
   */
  const onProgress = useCallback(
    (event: JobProgressEvent) => {
      if (event.status === 'running' || event.status === 'queued') {
        // A job we have not seen before is not in the cached list either, so the list has to
        // be refetched for its row to appear at all.
        //
        // Tracked in a ref rather than by reading `live`: depending on that state would give
        // this callback a new identity on every push, and `useIpcEvent` re-subscribes
        // whenever its listener changes — dropping whatever arrived in the gap. A ref also
        // keeps the check out of the state updater, which React is free to run twice.
        if (!seen.current.has(event.id)) {
          seen.current.add(event.id)
          invalidate()
        }
        setLive((current) => ({
          ...current,
          [event.id]: { progress: event.progress, message: event.message },
        }))
        return
      }

      seen.current.delete(event.id)

      // Terminal: drop the overlay and refetch, so the row leaves (succeeded, cancelled) or
      // reappears carrying its error (failed).
      setLive((current) => {
        if (!(event.id in current)) return current
        const { [event.id]: _finished, ...rest } = current
        return rest
      })
      invalidate()
    },
    [invalidate],
  )

  useIpcEvent('jobs.progress', onProgress)

  const cancelJob = useIpcMutation('jobs.cancel', { onSuccess: invalidate })
  const retryJob = useIpcMutation('jobs.retry', { onSuccess: invalidate })

  const jobs = useMemo(
    () => (data?.jobs ?? []).map((job) => toProcessingJob(job, live[job.id], t)),
    [data, live, t],
  )

  return {
    jobs,
    cancel: (id) => cancelJob.mutate({ id }),
    retry: (id) => retryJob.mutate({ id }),
  }
}

function toProcessingJob(
  job: JobSummary,
  live: LiveProgress | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): ProcessingJob {
  // The live value wins: it is newer than whatever the list was fetched with.
  const fraction = live?.progress ?? job.progress
  const detail = live?.message ?? job.progressMessage

  // `defaultValue` so an unrecognised kind reads as itself rather than a missing-key path.
  const label = t(`processingTray.kind.${job.kind}`, { defaultValue: job.kind })

  return {
    id: job.id,
    label: detail === null ? label : `${label} — ${detail}`,
    // The tray takes a percentage; the contract carries a fraction.
    ...(fraction === null ? {} : { progress: Math.round(fraction * 100) }),
    status: job.status === 'failed' ? 'failed' : job.status === 'queued' ? 'queued' : 'running',
    ...(job.error === null ? {} : { error: job.error }),
  }
}
