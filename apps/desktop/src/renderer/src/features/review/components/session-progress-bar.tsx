import { Progress, ProgressIndicator, ProgressTrack } from '@retenia/ui'
import { useT } from '../../../i18n/use-t'
import type { ReviewProgressDto } from '../use-review-session'

export interface SessionProgressBarProps {
  progress: ReviewProgressDto
  elapsedMs: number
}

/** "progress bar with remaining count and elapsed time" — §2 screen map. */
export function SessionProgressBar({ progress, elapsedMs }: SessionProgressBarProps) {
  const t = useT('review')
  const done = Math.max(0, progress.total - progress.remaining)
  const percent = progress.total > 0 ? Math.round((done / progress.total) * 100) : 0
  const minutes = Math.floor(elapsedMs / 60_000)
  const seconds = Math.floor((elapsedMs % 60_000) / 1000)

  return (
    <div className="flex items-center gap-3" data-testid="session-progress">
      <Progress value={percent} className="min-w-0 flex-1">
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      </Progress>
      <span
        className="text-muted w-20 shrink-0 text-right text-xs tabular-nums"
        data-testid="session-progress-remaining"
      >
        {t('screen.progress', { remaining: progress.remaining })}
      </span>
      <span
        className="text-muted w-12 shrink-0 text-right text-xs tabular-nums"
        data-testid="session-progress-elapsed"
      >
        {t('screen.elapsed', { minutes, seconds: String(seconds).padStart(2, '0') })}
      </span>
    </div>
  )
}
