import { Badge, Button, Celebration, Skeleton, StatTile } from '@retenia/ui'
import { useState } from 'react'
import { useT } from '../../i18n/use-t'
import type { ReviewSummaryDto } from './use-review-session'

export interface SessionSummaryProps {
  summary: ReviewSummaryDto | null
  onBackHome: () => void
  onReviewMore: () => void
}

/**
 * The end-of-session screen (`docs/spec/08-ux.md` §2 screen map): reviewed, accuracy, time,
 * an XP placeholder (13.1), the overload-protection postponed message, and a "Done for
 * today" celebration that respects sober mode and reduced motion — both handled inside
 * `Celebration` itself.
 */
export function SessionSummary({ summary, onBackHome, onReviewMore }: SessionSummaryProps) {
  const t = useT('review')
  const [celebrationOpen, setCelebrationOpen] = useState(true)

  if (summary === null) {
    return <Skeleton className="h-64 w-full" data-testid="session-summary-loading" />
  }

  const accuracyPercent = summary.accuracy === null ? null : Math.round(summary.accuracy * 100)
  const minutes = Math.round(summary.minutes * 10) / 10

  return (
    <div className="flex flex-col items-center gap-6 text-center" data-testid="session-summary">
      <Celebration
        open={celebrationOpen}
        onOpenChange={setCelebrationOpen}
        variant={summary.streak.goalMet ? 'dailyGoal' : 'lessonComplete'}
        title={t('summary.doneForToday')}
      />

      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">{t('summary.title')}</h1>
        <p className="text-muted">{t('summary.doneForToday')}</p>
      </div>

      <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          value={summary.reviewed}
          label={t('summary.reviewedLabel')}
          data-testid="summary-reviewed"
        />
        <StatTile
          value={accuracyPercent === null ? '—' : `${accuracyPercent}%`}
          label={t('summary.accuracyLabel')}
          data-testid="summary-accuracy"
        />
        <StatTile value={`${minutes}m`} label={t('summary.timeLabel')} data-testid="summary-time" />
        <StatTile
          value={<Badge variant="xp">{t('summary.xpPlaceholder')}</Badge>}
          label={t('summary.xpLabel')}
          data-testid="summary-xp"
        />
      </div>

      {summary.reviewed === 0 && <p className="text-muted text-sm">{t('summary.noAnswers')}</p>}

      {summary.postponed > 0 && (
        <p className="text-muted text-sm" data-testid="summary-postponed">
          {t('summary.postponed', { count: summary.postponed })}
        </p>
      )}

      {summary.streak.goalMet && (
        <p className="text-correct text-sm font-medium" data-testid="summary-streak-kept">
          {t('summary.streakKept')}
        </p>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBackHome} data-testid="summary-back-home">
          {t('summary.backHome')}
        </Button>
        <Button onClick={onReviewMore} data-testid="summary-review-more">
          {t('summary.reviewMore')}
        </Button>
      </div>
    </div>
  )
}
