import type { ImportanceLevel } from '@retenia/ipc-contract'
import { Button, Card, ProgressRing, Tooltip, TooltipContent, TooltipTrigger } from '@retenia/ui'
import { useNavigate } from '@tanstack/react-router'
import { FlameIcon } from 'lucide-react'
import { useT } from '../../i18n/use-t'
import { useIpcQuery } from '../../ipc/hooks'
import { ImportanceMixBanner } from './components/importance-mix-banner'

const DUE_LEVELS: Exclude<ImportanceLevel, 'paused'>[] = ['urgent', 'high', 'normal', 'maintenance']

/**
 * Home's "Today" card (`docs/spec/08-ux.md` §2 screen map): due per level, new,
 * reinforcement, the nearest exam with a readiness placeholder (10.1 has not landed),
 * a streak ring placeholder (13.1), the importance-mix bias warning and a "Modo urgente"
 * entry point, and the single primary "Repasar" action driven by `session.plan`.
 */
export function TodayCard() {
  const t = useT('review')
  const navigate = useNavigate()
  const { data: plan, isLoading } = useIpcQuery('session.plan', {})

  const hasDue = (plan?.counts.total ?? 0) > 0
  const minutes = plan ? Math.max(1, Math.round(plan.estimatedMinutes)) : 0
  const reviewCount = plan ? plan.counts.exam + plan.counts.due + plan.counts.relearning : 0

  return (
    <Card className="flex flex-col gap-5 p-6" data-testid="today-card">
      <ImportanceMixBanner />

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          {!isLoading && plan && (
            <div
              className="flex flex-wrap gap-x-3 gap-y-1 text-sm"
              data-testid="today-due-by-level"
            >
              {DUE_LEVELS.filter((level) => plan.counts.byLevel[level] > 0).map((level) => (
                <span key={level} className="text-muted" data-testid={`today-due-${level}`}>
                  {t(`today.dueByLevel.${level}`, { count: plan.counts.byLevel[level] })}
                </span>
              ))}
              {plan.counts.new > 0 && (
                <span className="text-muted" data-testid="today-new">
                  {t('today.new', { count: plan.counts.new })}
                </span>
              )}
              {plan.counts.reinforcement > 0 && (
                <span className="text-muted" data-testid="today-reinforcement">
                  {t('today.reinforcement')}
                </span>
              )}
              {!hasDue && <span className="text-muted">{t('today.nothingDue')}</span>}
            </div>
          )}
        </div>

        <Tooltip>
          <TooltipTrigger
            render={<button type="button" aria-label={t('today.streak.label', { count: 0 })} />}
          >
            <ProgressRing value={0} size={44} strokeWidth={4} />
          </TooltipTrigger>
          <TooltipContent>{t('today.streak.label', { count: 0 })}</TooltipContent>
        </Tooltip>
      </div>

      <p className="text-muted text-sm" data-testid="today-exam-readiness">
        {t('today.exam.readinessPlaceholder')}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          disabled={!hasDue}
          onClick={() => navigate({ to: '/review' })}
          data-testid="today-primary-action"
        >
          {t('today.primaryAction', { count: reviewCount, minutes })}
        </Button>
        <Button
          variant="outline"
          disabled={!hasDue}
          onClick={() => navigate({ to: '/review' })}
          data-testid="today-urgent-mode"
        >
          <FlameIcon />
          {t('today.urgentModeAction')}
        </Button>
      </div>
    </Card>
  )
}
