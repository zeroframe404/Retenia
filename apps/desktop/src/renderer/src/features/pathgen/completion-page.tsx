import { Button, ErrorState, StatTile } from '@retenia/ui'
import { useNavigate } from '@tanstack/react-router'
import { useT } from '../../i18n/use-t'
import { ExpansionPanel } from './expansion-panel'
import { usePathVersion } from './use-pathgen'

/**
 * "Confirmar ruta" step 6's completion summary
 * (`docs/spec/04-path-generation.md` §13 step 6): lessons, minutes, plan until the exam date,
 * "Regenerar ruta" (disabled — diff-based regeneration is sub-phase 8.6).
 *
 * It is also where stage 7 becomes visible (§13 step 5): freezing the path is what makes the
 * lessons expandable, and this is the screen the user lands on when they do. The panel starts
 * the expansion itself and shows each lesson as it lands.
 */
export interface CompletionPageProps {
  pathVersionId: string
  /** Opens stage 8's report (sub-phase 8.4). Absent, the button is not shown. */
  onOpenQaReport?: () => void
}

export function CompletionPage({ pathVersionId, onOpenQaReport }: CompletionPageProps) {
  const t = useT('path')
  const navigate = useNavigate()
  const version = usePathVersion(pathVersionId)

  if (version.isLoading) return null
  if (version.error || !version.data) return <ErrorState title={t('preview.loadError')} />

  const { draft } = version.data
  const { stats } = draft

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-testid="pathgen-completion">
      <h1 className="font-display text-2xl font-semibold">{t('completion.title')}</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label={t('completion.lessons')} value={stats.lessons} />
        <StatTile label={t('completion.minutes')} value={stats.minutes} />
        <StatTile label={t('completion.modules')} value={stats.modules} />
        <StatTile label={t('completion.concepts')} value={stats.concepts} />
      </div>
      {draft.target_date !== null && stats.weeks_estimate !== null && (
        <p className="text-muted text-sm">
          {t('completion.plan', { date: draft.target_date, weeks: stats.weeks_estimate })}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button
          disabled
          title={t('completion.regenerateDisabledReason')}
          data-testid="completion-regenerate"
        >
          {t('completion.regenerate')}
        </Button>
        {onOpenQaReport !== undefined && (
          <Button variant="outline" onClick={onOpenQaReport} data-testid="completion-qa-report">
            {t('completion.qaReport')}
          </Button>
        )}
      </div>
      {/* §13 step 5's "Reportar error (abre la cita)": the reader route of sub-phase 6.6 is
          the destination, the same one "Ver en la fuente" and "Continuar donde estaba" use. */}
      <ExpansionPanel
        pathVersionId={pathVersionId}
        onOpenSource={({ sourceId, page }) =>
          navigate({
            to: '/library',
            search: { sourceId, ...(page === null ? {} : { page }) },
          })
        }
      />
    </div>
  )
}
