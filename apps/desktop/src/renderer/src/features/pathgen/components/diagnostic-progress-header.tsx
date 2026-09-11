import { Progress, ProgressIndicator, ProgressTrack } from '@retenia/ui'
import { useT } from '../../../i18n/use-t'

/** `m:ss`, minutes unbounded — a diagnostic runs 12–15 min, and a long one must not wrap. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export interface DiagnosticProgressHeaderProps {
  asked: number
  /** "Quedan ~N": main's estimate, not a promise — the loop stops as soon as every module is placed. */
  remaining: number
  elapsedMs: number
}

/**
 * §13 step 4's "a bar of remaining items": how far along, roughly how many are left, and the
 * time spent. Nothing here counts right or wrong answers — the diagnostic places the learner,
 * it does not score them (`docs/spec/08-ux.md` §1: errors are data, never punished).
 */
export function DiagnosticProgressHeader({
  asked,
  remaining,
  elapsedMs,
}: DiagnosticProgressHeaderProps) {
  const t = useT('path')
  const total = asked + remaining
  const percent = total > 0 ? Math.round((asked / total) * 100) : 0

  return (
    <div className="flex items-center gap-3" data-testid="diagnostic-progress">
      <Progress
        value={percent}
        className="min-w-0 flex-1"
        aria-label={t('diagnostic.loop.progressLabel')}
      >
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      </Progress>
      <span
        aria-live="polite"
        aria-atomic="true"
        className="text-muted shrink-0 text-xs tabular-nums"
        data-testid="diagnostic-remaining"
      >
        {t('diagnostic.loop.remaining', { count: remaining })}
      </span>
      <span
        role="timer"
        aria-label={t('diagnostic.loop.elapsed')}
        className="text-muted w-12 shrink-0 text-right text-xs tabular-nums"
        data-testid="diagnostic-elapsed"
      >
        {formatElapsed(elapsedMs)}
      </span>
    </div>
  )
}
