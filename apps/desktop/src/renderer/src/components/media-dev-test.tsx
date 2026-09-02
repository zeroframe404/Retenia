import { useTranslation } from 'react-i18next'
import { useIpcQuery } from '../ipc/hooks'

/**
 * Dev-only: plays `resources/dev/sample.ogg` back through `media://`, proving the protocol
 * — and seeking via Range requests — works end to end (sub-phase 1.3). `app.devMediaSampleUrl`
 * resolves to `null` in a packaged build, so this renders nothing there.
 */
export function MediaDevTest() {
  const { t } = useTranslation('common')
  const sample = useIpcQuery('app.devMediaSampleUrl', undefined)
  const url = sample.data?.url

  if (!url) {
    return null
  }

  return (
    <section className="flex flex-col items-center gap-2 text-sm">
      <h2 className="font-medium text-slate-500 dark:text-slate-400">
        {t('mediaDevTest.heading')}
      </h2>
      {/* biome-ignore lint/a11y/useMediaCaption: a synthesized test tone has nothing to caption. */}
      <audio data-testid="media-dev-audio" controls src={url} />
    </section>
  )
}
