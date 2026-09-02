import { Button } from '@retenia/ui'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useT } from '../i18n/use-t'
import { useDueCount } from '../shell/use-due-count'

/**
 * Home / Today (`docs/spec/08-ux.md` §2). The screen map's full "Today" card — due by
 * level, streak ring, heatmap, active paths, AI insights — arrives with the phases that
 * own that data (F4 review queue, F9 paths, F13 gamification). What this screen owes
 * *now* is §1's first UX principle: "one primary action per screen. The home answers
 * 'what do I do today?' with one button". So it renders exactly one call to action,
 * driven by the real due count (`useDueCount`, still 0 until F4) — never a second
 * competing button, and never invented numbers.
 */
export function HomeScreen() {
  const t = useT('home')
  const navigate = useNavigate()
  const dueCount = useDueCount()
  const hasDue = dueCount > 0

  return (
    <div data-testid="screen-home" className="flex flex-col gap-6 p-6 compact:gap-4 compact:p-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted" data-testid="home-summary">
          {hasDue ? t('dueSummary', { count: dueCount }) : t('nothingDue')}
        </p>
      </div>

      <div>
        <Button
          size="lg"
          disabled={!hasDue}
          onClick={() => navigate({ to: '/review' })}
          data-testid="home-primary-action"
        >
          {t('startReview')}
        </Button>
      </div>

      <p className="text-muted text-sm">{t('comingSoon')}</p>
    </div>
  )
}

export const Route = createFileRoute('/')({
  component: HomeScreen,
})
