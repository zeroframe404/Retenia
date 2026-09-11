import { Button, ErrorState, StatTile } from '@retenia/ui'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useT } from '../../i18n/use-t'
import { RegeneratePanel } from './components/regenerate-panel'
import { ExpansionPanel } from './expansion-panel'
import {
  useAffectedLessons,
  usePathVersion,
  useRegenerateAffected,
  useRegeneratePath,
} from './use-pathgen'

/**
 * "Confirmar ruta" step 6's completion summary
 * (`docs/spec/04-path-generation.md` §13 step 6): lessons, minutes, plan until the exam date,
 * and "Regenerar ruta" — a new version with a per-lesson diff (sub-phase 8.6) — beside
 * "Regenerar afectadas" for the lessons whose sources changed since they were written.
 *
 * It is also where stage 7 becomes visible (§13 step 5): freezing the path is what makes the
 * lessons expandable, and this is the screen the user lands on when they do. The panel starts
 * the expansion itself and shows each lesson as it lands.
 */
export interface CompletionPageProps {
  pathVersionId: string
  /** Opens stage 8's report (sub-phase 8.4). Absent, the button is not shown. */
  onOpenQaReport?: () => void
  /** "Regenerar ruta" wrote a new, unfrozen version: the route opens its preview (8.6). */
  onRegenerated?: (next: { pathVersionId: string; runId: string }) => void
}

export function CompletionPage({
  pathVersionId,
  onOpenQaReport,
  onRegenerated,
}: CompletionPageProps) {
  const t = useT('path')
  const navigate = useNavigate()
  const version = usePathVersion(pathVersionId)
  const affected = useAffectedLessons(pathVersionId)
  const regenerate = useRegeneratePath()
  const regenerateAffected = useRegenerateAffected(pathVersionId)
  const [regenerateError, setRegenerateError] = useState<string | null>(null)

  if (version.isLoading) return null
  if (version.error || !version.data) return <ErrorState title={t('preview.loadError')} />

  const { draft, path } = version.data
  const { stats } = draft

  function handleRegenerate(): void {
    setRegenerateError(null)
    regenerate.mutate(
      { pathId: path.id },
      {
        onSuccess: (result) => {
          // A run the budget paused, or one that failed, wrote no version to open.
          if (result.pathVersionId === null) {
            setRegenerateError(result.error ?? t('regenerate.error'))
            return
          }
          onRegenerated?.({ pathVersionId: result.pathVersionId, runId: result.runId })
        },
        onError: () => setRegenerateError(t('regenerate.error')),
      },
    )
  }

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
      {onOpenQaReport !== undefined && (
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={onOpenQaReport} data-testid="completion-qa-report">
            {t('completion.qaReport')}
          </Button>
        </div>
      )}
      <RegeneratePanel
        affected={affected.data}
        regenerating={regenerate.isPending}
        regeneratingAffected={regenerateAffected.isPending}
        error={regenerateError}
        onRegenerate={handleRegenerate}
        onRegenerateAffected={() => regenerateAffected.mutate({ pathVersionId })}
      />
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
