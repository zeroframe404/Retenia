import { ChevronDownIcon, ChevronUpIcon, RotateCwIcon, XIcon } from 'lucide-react'
import { cn } from '../lib/cn'
import { Badge } from './badge'
import { IconButton } from './button'
import { Progress, ProgressIndicator, ProgressTrack } from './progress'

/**
 * The subset of the queue's statuses a tray row can be in.
 *
 * `succeeded` is absent on purpose: a finished job leaves the tray rather than sitting in it
 * with a full bar. `cancelled` is absent for the same reason — cancelling removes the row.
 */
export type ProcessingJobStatus = 'queued' | 'running' | 'failed'

export interface ProcessingJob {
  id: string
  label: string
  /** 0–100; omitted renders an indeterminate row (label only). */
  progress?: number
  /** Defaults to `'running'`. */
  status?: ProcessingJobStatus
  /** Why it failed. Shown under the label when `status` is `'failed'`. */
  error?: string
}

/**
 * One submitted AI batch (`docs/spec/06-ai-providers.md` §2), as a tray row.
 *
 * Separate from `ProcessingJob` rather than folded into it because the two are different
 * kinds of work with different controls. A job runs in this app's own worker pool, reports a
 * fraction, and can be retried; a batch is a job on a *provider's* queue that may take up to
 * 24 h, reports "12 of 40 answered", costs money, and can only be abandoned. Sharing one row
 * type would mean a retry button that does nothing on half the rows and a cost that is blank
 * on the other half.
 */
export interface ProcessingBatch {
  id: string
  /** What is being generated, already counted: "Lote 12/40 lecciones". */
  label: string
  /** Cost and state, already formatted: "~USD 1.10 · esperando". */
  detail?: string
  /** 0–100. Omitted while nothing has come back yet. */
  progress?: number
  /** The batch ended badly, or ended with failures among its requests. */
  failed?: boolean
  error?: string
}

export interface ProcessingTrayProps {
  jobs: ProcessingJob[]
  /**
   * Submitted AI batches. Rendered above the jobs, because they are the slow half — a batch
   * outlives every job in the queue and is what somebody watching the tray is waiting on.
   */
  batches?: ProcessingBatch[]
  /** Per-batch cancel. A batch cannot be retried: resubmitting is the caller's decision,
   * with a price attached, and belongs to the feature that owns the work. */
  onCancelBatch?: (id: string) => void
  /** Heading for the batch section, shown only when there is at least one. */
  batchesLabel?: string
  collapsed: boolean
  onToggleCollapsed: () => void
  title: string
  emptyState: string
  collapseLabel: string
  expandLabel: string
  /** Full ICU-pluralized sentence ("3 jobs running") for the count badge's accessible
   * name — the visible badge stays a compact digit, screen readers get the whole sentence. */
  jobCountLabel?: string
  /** Per-job controls (docs/spec/08-ux.md §1.6: "long operations live in a progress panel
   * with cancel/resume"). Each button renders only when its handler is supplied, so a
   * caller whose jobs are not cancellable simply omits it. */
  onCancelJob?: (id: string) => void
  /** Only ever offered for a `failed` job — there is nothing to retry about a running one. */
  onRetryJob?: (id: string) => void
  /** Accessible names for the icon-only per-job controls; required in practice by whichever
   * of `onCancelJob`/`onRetryJob` is supplied. */
  cancelLabel?: string
  retryLabel?: string
  /** Shown in place of a progress bar for a job that has not started yet. */
  queuedLabel?: string
  className?: string
}

/**
 * Bottom tray for background jobs (`docs/spec/07-architecture.md` §7's "Processing panel").
 *
 * Presentational: `jobs` is always the real list, never fake data, and every control is a
 * callback the host supplies. The desktop shell feeds it from `jobs.list` plus the
 * `jobs.progress` push.
 *
 * There is deliberately no pause/resume. The `jobs` table has no `paused` status and adding
 * one would mean editing an applied migration, so a pause button here could only ever be a
 * button that does nothing. Cancel and retry are what the queue can actually honour.
 */
export function ProcessingTray({
  jobs,
  batches = [],
  onCancelBatch,
  batchesLabel,
  collapsed,
  onToggleCollapsed,
  title,
  emptyState,
  collapseLabel,
  expandLabel,
  jobCountLabel,
  onCancelJob,
  onRetryJob,
  cancelLabel,
  retryLabel,
  queuedLabel,
  className,
}: ProcessingTrayProps) {
  return (
    <div className={cn('border-border bg-surface shrink-0 border-t', className)}>
      <div className="flex h-9 items-center gap-2 px-3 compact:h-7 compact:px-2">
        <span className="text-text text-xs font-medium">{title}</span>
        {jobs.length + batches.length > 0 && (
          <Badge variant="neutral" aria-label={jobCountLabel} data-testid="processing-tray-count">
            {jobs.length + batches.length}
          </Badge>
        )}
        <div className="flex-1" />
        <IconButton
          variant="ghost"
          size="sm"
          aria-label={collapsed ? expandLabel : collapseLabel}
          onClick={onToggleCollapsed}
          data-testid="processing-tray-toggle"
        >
          {collapsed ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </IconButton>
      </div>
      {!collapsed && (
        <div className="max-h-40 overflow-y-auto px-3 pb-3">
          {batches.length > 0 && (
            <div className="mb-2 flex flex-col gap-2" data-testid="processing-tray-batches">
              {batchesLabel !== undefined && (
                <span className="text-muted text-xs font-medium">{batchesLabel}</span>
              )}
              <ul className="flex flex-col gap-2">
                {batches.map((batch) => (
                  <li key={batch.id} className="flex items-start gap-2 text-sm">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{batch.label}</span>
                      {batch.detail !== undefined && (
                        <span className="text-muted truncate text-xs">{batch.detail}</span>
                      )}
                      {batch.failed === true && batch.error !== undefined && (
                        <span
                          title={batch.error}
                          className="text-incorrect truncate text-xs"
                          data-testid={`processing-batch-error-${batch.id}`}
                        >
                          {batch.error}
                        </span>
                      )}
                    </div>
                    {batch.progress !== undefined && batch.failed !== true && (
                      <Progress value={batch.progress} className="w-24 shrink-0">
                        <ProgressTrack>
                          <ProgressIndicator />
                        </ProgressTrack>
                      </Progress>
                    )}
                    {onCancelBatch && (
                      <IconButton
                        variant="ghost"
                        size="sm"
                        aria-label={cancelLabel ?? 'Cancel'}
                        onClick={() => onCancelBatch(batch.id)}
                        data-testid={`processing-batch-cancel-${batch.id}`}
                      >
                        <XIcon />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {jobs.length === 0 ? (
            batches.length === 0 ? (
              <p className="text-muted text-sm">{emptyState}</p>
            ) : null
          ) : (
            <ul className="flex flex-col gap-2">
              {jobs.map((job) => {
                const status = job.status ?? 'running'
                const failed = status === 'failed'
                return (
                  <li key={job.id} className="flex items-start gap-2 text-sm">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{job.label}</span>
                      {failed && job.error !== undefined && (
                        <span
                          // `title` carries the untruncated text: a stack-shaped error can
                          // be far longer than one tray row, and the row must not grow.
                          title={job.error}
                          // `incorrect` rather than a raw red: it is the semantic failure
                          // token, and it is the one `tooling/scripts/contrast-check.mjs`
                          // holds to 4.5:1 against `surface` in both themes.
                          className="text-incorrect truncate text-xs"
                          data-testid={`processing-job-error-${job.id}`}
                        >
                          {job.error}
                        </span>
                      )}
                    </div>
                    {status === 'queued' && queuedLabel !== undefined && (
                      <span className="text-muted shrink-0 text-xs">{queuedLabel}</span>
                    )}
                    {status === 'running' && job.progress !== undefined && (
                      <Progress value={job.progress} className="w-24 shrink-0">
                        <ProgressTrack>
                          <ProgressIndicator />
                        </ProgressTrack>
                      </Progress>
                    )}
                    {failed && onRetryJob && (
                      <IconButton
                        variant="ghost"
                        size="sm"
                        aria-label={retryLabel ?? 'Retry'}
                        onClick={() => onRetryJob(job.id)}
                        data-testid={`processing-job-retry-${job.id}`}
                      >
                        <RotateCwIcon />
                      </IconButton>
                    )}
                    {onCancelJob && (
                      <IconButton
                        variant="ghost"
                        size="sm"
                        aria-label={cancelLabel ?? 'Cancel'}
                        onClick={() => onCancelJob(job.id)}
                        data-testid={`processing-job-cancel-${job.id}`}
                      >
                        <XIcon />
                      </IconButton>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
