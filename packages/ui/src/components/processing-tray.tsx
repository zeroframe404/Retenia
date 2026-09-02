import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { cn } from '../lib/cn'
import { Badge } from './badge'
import { IconButton } from './button'
import { Progress, ProgressIndicator, ProgressTrack } from './progress'

export interface ProcessingJob {
  id: string
  label: string
  /** 0–100; omitted renders an indeterminate row (label only). */
  progress?: number
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
  className?: string
}

/** Bottom tray for background jobs (ingestion, path generation, exports — none of which
 * exist yet; the job queue lands in sub-phase 3.4). Presentational: `jobs` is always the
 * real (currently empty) list, never fake data. */
export function ProcessingTray({
  jobs,
  collapsed,
  onToggleCollapsed,
  title,
  emptyState,
  collapseLabel,
  expandLabel,
  jobCountLabel,
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
              {jobs.map((job) => (
                <li key={job.id} className="flex items-center gap-3 text-sm">
                  <span className="flex-1 truncate">{job.label}</span>
                  {job.progress !== undefined && (
                    <Progress value={job.progress} className="w-24">
                      <ProgressTrack>
                        <ProgressIndicator />
                      </ProgressTrack>
                    </Progress>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
