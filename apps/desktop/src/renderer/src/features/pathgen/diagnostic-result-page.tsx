import type { DiagnosticModuleResultDto } from '@retenia/ipc-contract'
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Skeleton,
  StatTile,
  Switch,
} from '@retenia/ui'
import { useId, useState } from 'react'
import { useT } from '../../i18n/use-t'
import {
  DiagnosticModuleRow,
  effectiveStatus,
  isRevertible,
} from './components/diagnostic-module-row'
import { formatElapsed } from './components/diagnostic-progress-header'
import { useDiagnostic, useDiagnosticRevert } from './use-pathgen'

/**
 * The diagnostic's summary (`docs/spec/04-path-generation.md` §13 step 4: *"summary of what is
 * marked completed, reversible"*): per module what the diagnostic concluded and what it did —
 * lessons marked completed, cards seeded — with a one-click undo per module and for all of
 * them. The Elo values stay behind "Avanzado": they are the evidence, not the message.
 */

export interface DiagnosticResultPageProps {
  pathVersionId: string
  /** On to the completion screen, which starts the expansion. */
  onContinue: () => void
}

/** Modules grouped under their section, in the order main listed them. */
function bySection(modules: readonly DiagnosticModuleResultDto[]) {
  const groups = new Map<string, DiagnosticModuleResultDto[]>()
  for (const module of modules) {
    const group = groups.get(module.sectionTitle)
    if (group) group.push(module)
    else groups.set(module.sectionTitle, [module])
  }
  return [...groups].map(([title, members]) => ({ title, modules: members }))
}

export function DiagnosticResultPage({ pathVersionId, onContinue }: DiagnosticResultPageProps) {
  const t = useT('path')
  const diagnostic = useDiagnostic(pathVersionId)
  const revert = useDiagnosticRevert(pathVersionId)
  const [advanced, setAdvanced] = useState(false)
  const [confirmingAll, setConfirmingAll] = useState(false)
  const advancedLabelId = useId()

  if (diagnostic.isLoading) {
    return <Skeleton className="m-6 h-64" data-testid="diagnostic-result-loading" />
  }
  if (diagnostic.error || !diagnostic.data) {
    return (
      <ErrorState
        className="m-6"
        title={t('diagnostic.loadError')}
        retryLabel={t('diagnostic.retry')}
        onRetry={() => void diagnostic.refetch()}
      />
    )
  }

  const { state } = diagnostic.data
  const result = state?.result ?? null
  if (state === null || result === null) {
    return (
      <div className="p-6" data-testid="diagnostic-result-page">
        <EmptyState
          title={t('diagnostic.result.empty')}
          action={<Button onClick={onContinue}>{t('diagnostic.result.continue')}</Button>}
        />
      </div>
    )
  }

  const sessionId = state.session.id
  const counts = { known: 0, partial: 0, unknown: 0 }
  for (const module of result.modules) counts[effectiveStatus(module)] += 1
  const anyRevertible = result.modules.some(isRevertible)
  const revertingModuleId = revert.isPending ? (revert.variables?.moduleId ?? null) : null

  return (
    <div
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 overflow-y-auto p-6"
      data-testid="diagnostic-result-page"
    >
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">{t('diagnostic.result.title')}</h1>
        <p className="text-muted text-sm" data-testid="diagnostic-stop-reason">
          {t(`diagnostic.result.stopReason.${result.stopReason}`)}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatTile
          label={t('diagnostic.result.stats.known')}
          value={counts.known}
          data-testid="diagnostic-stat-known"
        />
        <StatTile
          label={t('diagnostic.result.stats.partial')}
          value={counts.partial}
          data-testid="diagnostic-stat-partial"
        />
        <StatTile
          label={t('diagnostic.result.stats.unknown')}
          value={counts.unknown}
          data-testid="diagnostic-stat-unknown"
        />
        <StatTile
          label={t('diagnostic.result.stats.asked')}
          value={result.asked}
          data-testid="diagnostic-stat-asked"
        />
        <StatTile
          label={t('diagnostic.result.stats.time')}
          value={formatElapsed(result.elapsedMs)}
          data-testid="diagnostic-stat-time"
        />
      </div>

      {result.remediations.length > 0 && (
        <p className="text-sm" data-testid="diagnostic-remediations">
          {t('diagnostic.result.remediations', { count: result.remediations.length })}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm">
          <span id={advancedLabelId}>{t('diagnostic.result.advanced')}</span>
          <Switch
            checked={advanced}
            onCheckedChange={setAdvanced}
            aria-labelledby={advancedLabelId}
            data-testid="diagnostic-advanced"
          />
        </div>
        {anyRevertible && (
          <Button
            variant="outline"
            onClick={() => setConfirmingAll(true)}
            disabled={revert.isPending}
            data-testid="diagnostic-revert-all"
          >
            {t('diagnostic.result.revertAll')}
          </Button>
        )}
      </div>

      {revert.isError && (
        <p role="alert" className="text-incorrect text-sm">
          {t('diagnostic.result.revertError')}
        </p>
      )}

      <div className="flex flex-col gap-5">
        {bySection(result.modules).map((group) => (
          <section key={group.title} className="flex flex-col gap-2">
            <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">
              {group.title}
            </h2>
            <ul className="flex flex-col gap-2">
              {group.modules.map((module) => (
                <li key={module.moduleId}>
                  <DiagnosticModuleRow
                    module={module}
                    advanced={advanced}
                    reverting={revertingModuleId === module.moduleId}
                    onRevert={() => revert.mutate({ sessionId, moduleId: module.moduleId })}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <footer className="flex justify-end">
        <Button onClick={onContinue} data-testid="diagnostic-continue">
          {t('diagnostic.result.continue')}
        </Button>
      </footer>

      <ConfirmDialog
        open={confirmingAll}
        onOpenChange={setConfirmingAll}
        title={t('diagnostic.result.revertAllTitle')}
        description={t('diagnostic.result.revertAllDescription')}
        confirmLabel={t('diagnostic.result.revertAll')}
        cancelLabel={t('diagnostic.result.cancel')}
        destructive
        confirming={revert.isPending}
        onConfirm={() => revert.mutate({ sessionId }, { onSettled: () => setConfirmingAll(false) })}
      />
    </div>
  )
}
