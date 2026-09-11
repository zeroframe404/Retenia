import type { PathgenRemediationEvent, RemediationDto } from '@retenia/ipc-contract'
import { toast } from '@retenia/ui'
import { useCallback } from 'react'
import { useT } from '../../../i18n/use-t'
import { useIpcEvent } from '../../../ipc/hooks'

/**
 * The "desvío sugerido" toast (sub-phase 8.6, `docs/spec/04-path-generation.md` §11): wherever
 * the learner is — the review screen is where most of §11's triggers fire — a detour that was
 * just inserted announces itself with the reason it was, in the learner's own numbers. A refusal
 * the learner asked for ("no lo entiendo") says why nothing appeared; a failure says so.
 *
 * Mounted once, beside the app's `Toaster`. Renders nothing.
 */

type Translate = ReturnType<typeof useT>

const percent = (value: number | null): number => Math.round((value ?? 0) * 100)

/** The sentence behind a detour, from the evidence its trigger saw. */
export function remediationReason(t: Translate, remediation: RemediationDto): string {
  const concept = remediation.conceptName
  const { reasons } = remediation
  switch (remediation.trigger) {
    case 'reinforcement_low':
      return t('remediation.reason.reinforcement_low', {
        concept,
        percent: percent(reasons.accuracy),
      })
    case 'memory_lapses':
      return t('remediation.reason.memory_lapses', { concept, count: reasons.lapses ?? 0 })
    case 'memory_retention':
      return t('remediation.reason.memory_retention', { concept, percent: percent(reasons.meanR) })
    default:
      return t(`remediation.reason.${remediation.trigger}`, { concept })
  }
}

export interface RemediationToast {
  readonly kind: 'info' | 'warning' | 'error'
  readonly title: string
  readonly description?: string
}

/** What one push shows, or `null` when it shows nothing (a detour being written, say). */
export function remediationToast(
  t: Translate,
  event: PathgenRemediationEvent,
): RemediationToast | null {
  const { remediation } = event
  const concept = remediation.conceptName
  if (event.kind === 'inserted') {
    return {
      kind: 'info',
      title: t('remediation.toastTitle', { title: remediation.title ?? concept }),
      description: remediationReason(t, remediation),
    }
  }
  if (event.kind === 'failed') return { kind: 'error', title: t('remediation.failed', { concept }) }
  // A refusal is news only to someone who asked; the rest are the log's business.
  if (
    event.kind === 'refused' &&
    remediation.refusal !== null &&
    remediation.trigger === 'user_request'
  ) {
    return { kind: 'warning', title: t(`remediation.refused.${remediation.refusal}`, { concept }) }
  }
  return null
}

export function RemediationToaster() {
  const t = useT('path')
  useIpcEvent(
    'pathgen.remediation',
    useCallback(
      (event: PathgenRemediationEvent) => {
        const shown = remediationToast(t, event)
        if (shown === null) return
        if (shown.kind === 'error') toast.error(shown.title)
        else if (shown.kind === 'warning') toast.warning(shown.title)
        else
          toast(
            shown.title,
            shown.description === undefined ? {} : { description: shown.description },
          )
      },
      [t],
    ),
  )
  return null
}
