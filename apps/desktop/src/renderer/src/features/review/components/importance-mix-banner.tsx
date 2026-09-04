import { AlertTriangleIcon } from 'lucide-react'
import { useT } from '../../../i18n/use-t'
import { useIpcQuery } from '../../../ipc/hooks'

/** §7 rule 4's guard: "if everything is urgent, nothing is" — shown wherever the queue is
 *  skewed toward Urgent/High, per `docs/spec/02-memory-system.md`. */
export function ImportanceMixBanner() {
  const t = useT('review')
  const { data } = useIpcQuery('memory.importanceMix', undefined)

  if (!data?.biasWarning) return null
  const percent = Math.round(data.prioritizedShare * 100)

  return (
    <div
      role="status"
      data-testid="importance-mix-banner"
      className="border-incorrect/30 bg-incorrect/5 text-text flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
    >
      <AlertTriangleIcon aria-hidden="true" className="text-incorrect size-4 shrink-0" />
      <span>{t('importance.biasWarning', { percent })}</span>
    </div>
  )
}
