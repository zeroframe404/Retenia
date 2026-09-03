import type { Job } from '@retenia/core'
import type { JobSummary } from '@retenia/ipc-contract'
import { redactPaths, redactPathsOrNull } from './redact'

/**
 * `Job` → what crosses the bridge.
 *
 * One place, so `jobs.list`, `jobs.cancel`, `jobs.retry` and the `jobs.progress` push cannot
 * disagree about what a job looks like. Note what is *not* here: `payload` (arbitrary, and
 * the renderer never needs it), the lease columns, and the audit set.
 */

/** The shape the runner writes into `jobs.progress`; see core's `JobProgress`. */
function readProgress(progress: Job['progress']): { value: number | null; message: string | null } {
  if (progress === null) return { value: null, message: null }
  const value = progress.value
  const message = progress.message
  return {
    value: typeof value === 'number' ? value : null,
    message: typeof message === 'string' ? redactPaths(message) : null,
  }
}

export function toJobSummary(job: Job): JobSummary {
  const { value, message } = readProgress(job.progress)
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    priority: job.priority,
    progress: value,
    progressMessage: message,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    error: redactPathsOrNull(job.error),
    subjectId: job.subjectId,
    result: job.result,
    runAfter: job.runAfter.toISOString(),
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  }
}
