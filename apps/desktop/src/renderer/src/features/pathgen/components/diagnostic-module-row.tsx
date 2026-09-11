import type { DiagnosticModuleResultDto, DiagnosticModuleStatusDto } from '@retenia/ipc-contract'
import { Badge, Button } from '@retenia/ui'
import { useT } from '../../../i18n/use-t'

/**
 * Nothing here is red: "por estudiar" is a plan, not a failure (`docs/spec/08-ux.md` §1,
 * "never punish: errors are data"). Known reads as good news, partial as a light nudge.
 */
const STATUS_VARIANT = {
  known: 'correct',
  partial: 'xp',
  unknown: 'neutral',
} as const satisfies Record<DiagnosticModuleStatusDto, 'correct' | 'xp' | 'neutral'>

/**
 * Whether "Deshacer" applies: only a module the diagnostic marked known has anything to take
 * back (its `mark_completed` and `seed_memory`), and a reverted or reopened one already gave it
 * back.
 */
export function isRevertible(module: DiagnosticModuleResultDto): boolean {
  return module.status === 'known' && !module.reverted && !module.reopened
}

/** A reverted or reopened module is back to being studied, whatever the diagnostic said. */
export function effectiveStatus(module: DiagnosticModuleResultDto): DiagnosticModuleStatusDto {
  return module.reverted || module.reopened ? 'unknown' : module.status
}

export interface DiagnosticModuleRowProps {
  module: DiagnosticModuleResultDto
  /**
   * The "Avanzado" values — θ, P = σ(θ) and the evidence counts. Off by default: an Elo number
   * means nothing to most learners and invites reading the result as a grade.
   */
  advanced: boolean
  /** Absent, the row offers no undo even for a known module (e.g. a read-only summary). */
  onRevert?: () => void
  reverting?: boolean
}

/** One module of §13 step 4's summary: what the diagnostic decided and what it did about it. */
export function DiagnosticModuleRow({
  module,
  advanced,
  onRevert,
  reverting = false,
}: DiagnosticModuleRowProps) {
  const t = useT('path')
  const canRevert = onRevert !== undefined && isRevertible(module)
  const applied = module.status === 'known' && !module.reverted && !module.reopened
  // The badge says what the module is now, so it agrees with the counts above it; what the
  // diagnostic had concluded stays visible underneath, as history.
  const status = effectiveStatus(module)

  return (
    <article
      className="border-border flex flex-col gap-2 rounded-lg border p-4"
      data-testid={`diagnostic-module-${module.specId}`}
      data-status={status}
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="grow text-sm font-semibold">{module.title}</h3>
        <Badge variant={STATUS_VARIANT[status]}>{t(`diagnostic.result.status.${status}`)}</Badge>
        {module.reverted && (
          <Badge variant="outline" data-testid={`diagnostic-module-reverted-${module.specId}`}>
            {t('diagnostic.result.reverted')}
          </Badge>
        )}
        {canRevert && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onRevert}
            disabled={reverting}
            aria-label={t('diagnostic.result.revertModule', { title: module.title })}
            data-testid={`diagnostic-revert-${module.specId}`}
          >
            {t('diagnostic.result.revert')}
          </Button>
        )}
      </header>

      {applied && (
        <p className="text-muted text-xs">
          {t('diagnostic.result.completed', {
            lessons: module.lessonsCompleted,
            cards: module.seededCards,
          })}
          {module.pendingSeedLessons > 0 &&
            ` · ${t('diagnostic.result.pendingSeed', { count: module.pendingSeedLessons })}`}
        </p>
      )}

      {module.source !== 'diagnostic' && (
        <p className="text-muted text-xs">{t(`diagnostic.result.source.${module.source}`)}</p>
      )}

      {status !== module.status && (
        <p className="text-muted text-xs" data-testid={`diagnostic-module-was-${module.specId}`}>
          {t('diagnostic.result.wasStatus', {
            status: t(`diagnostic.result.status.${module.status}`),
          })}
        </p>
      )}

      {module.reopened && module.reopenReason !== null && (
        <p className="text-xs" data-testid={`diagnostic-module-reopened-${module.specId}`}>
          {t(`diagnostic.result.reopened.${module.reopenReason}`)}
        </p>
      )}

      {advanced && (
        <p
          className="text-muted flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums"
          data-testid={`diagnostic-module-advanced-${module.specId}`}
        >
          <span>{t('diagnostic.result.theta', { value: module.theta.toFixed(2) })}</span>
          <span>{t('diagnostic.result.probability', { percent: Math.round(module.p * 100) })}</span>
          <span>
            {t('diagnostic.result.evidence', {
              answered: module.answered,
              inferred: module.inferred,
            })}
          </span>
        </p>
      )}
    </article>
  )
}
