import { ChevronDownIcon, ChevronUpIcon, PauseIcon, PlayIcon, XIcon } from 'lucide-react'
import { cn } from '../lib/cn'
import { Badge } from './badge'
import { IconButton } from './button'
import { Progress, ProgressIndicator, ProgressTrack } from './progress'

export interface ProcessingJob {
  id: string
  label: string
  /** 0–100; omitted renders an indeterminate row (label only). */
  progress?: number
  /** Defaults to `'running'`. A paused job keeps its progress and offers Resume. */
  status?: 'running' | 'paused'
}

export interface ProcessingTrayProps {
  jobs: ProcessingJob[]
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
   * caller whose jobs are not cancellable or not pausable simply omits it. */
  onCancelJob?: (id: string) => void
  onPauseJob?: (id: string) => void
  onResumeJob?: (id: string) => void
  /** Accessible names for the per-job controls; required in practice by whichever of
   * `onCancelJob`/`onPauseJob`/`onResumeJob` is supplied, since the buttons are icon-only. */
  cancelLabel?: string
  pauseLabel?: string
  resumeLabel?: string
  className?: string
}

/** Bottom tray for background jobs (ingestion, path generation, exports — none of which
 * exist yet; the job queue lands in sub-phase 3.4). Presentational: `jobs` is always the
 * real (currently empty) list, never fake data, and every control is a callback the host
 * supplies. The cancel/pause/resume seam exists now so 3.4 wires handlers to a shape that
 * already expresses §1.6's "progress panel with cancel/resume" instead of widening it. */
export function ProcessingTray({
  jobs,
  collapsed,
  onToggleCollapsed,
  title,
  emptyState,
  collapseLabel,
  expandLabel,
  jobCountLabel,
  onCancelJob,
  onPauseJob,
  onResumeJob,
  cancelLabel,
  pauseLabel,
  resumeLabel,
  className,
}: ProcessingTrayProps) {
  return (
    <div className={cn('border-border bg-surface shrink-0 border-t', className)}>
      <div className="flex h-9 items-center gap-2 px-3 compact:h-7 compact:px-2">
        <span className="text-text text-xs font-medium">{title}</span>
        {jobs.length > 0 && (
          <Badge variant="neutral" aria-label={jobCountLabel} data-testid="processing-tray-count">
            {jobs.length}
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
          {jobs.length === 0 ? (
            <p className="text-muted text-sm">{emptyState}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {jobs.map((job) => {
                const paused = job.status === 'paused'
                return (
                  <li key={job.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{job.label}</span>
                    {job.progress !== undefined && (
                      <Progress value={job.progress} className="w-24">
                        <ProgressTrack>
                          <ProgressIndicator />
                        </ProgressTrack>
                      </Progress>
                    )}
                    {paused && onResumeJob && (
                      <IconButton
                        variant="ghost"
                        size="sm"
                        aria-label={resumeLabel ?? 'Resume'}
                        onClick={() => onResumeJob(job.id)}
                        data-testid={`processing-job-resume-${job.id}`}
                      >
                        <PlayIcon />
                      </IconButton>
                    )}
                    {!paused && onPauseJob && (
                      <IconButton
                        variant="ghost"
                        size="sm"
                        aria-label={pauseLabel ?? 'Pause'}
                        onClick={() => onPauseJob(job.id)}
                        data-testid={`processing-job-pause-${job.id}`}
                      >
                        <PauseIcon />
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
