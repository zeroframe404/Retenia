import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIpcMutation, useIpcQuery } from '../ipc/hooks'

/**
 * Proves the typed IPC bridge end to end: a read (`app.getVersion`) through
 * `useIpcQuery`, and a write (`app.ping`) through `useIpcMutation`. Replaced by real
 * screens from sub-phase 2.2 onward.
 */
export function IpcDemo() {
  const { t } = useTranslation('common')
  const [roundTripMs, setRoundTripMs] = useState<number | null>(null)

  const versions = useIpcQuery('app.getVersion', undefined)
  const ping = useIpcMutation('app.ping', {
    onSuccess: (data) => {
      setRoundTripMs(Date.now() - Date.parse(data.sentAt))
    },
  })

  return (
    <section className="flex flex-col items-center gap-3 text-sm">
      <h2 className="font-medium text-slate-500 dark:text-slate-400">{t('ipc.heading')}</h2>

      <dl
        data-testid="versions"
        className="grid grid-cols-2 gap-x-4 text-slate-600 dark:text-slate-300"
      >
        {versions.isPending && <dd className="col-span-2">{t('ipc.loading')}</dd>}
        {versions.data &&
          Object.entries(versions.data).map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-right">{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>

      <button
        type="button"
        onClick={() => ping.mutate({ sentAt: new Date().toISOString() })}
        disabled={ping.isPending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {ping.isPending ? t('ipc.pinging') : t('ipc.ping')}
      </button>

      {roundTripMs !== null && !ping.isError && (
        <p data-testid="ping-result">{t('ipc.roundTrip', { ms: roundTripMs })}</p>
      )}
      {ping.isError && (
        <p data-testid="ping-error" className="text-red-600 dark:text-red-400">
          {t('ipc.failed', { message: ping.error.message })}
        </p>
      )}
    </section>
  )
}
