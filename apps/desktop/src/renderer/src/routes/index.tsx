import { createFileRoute } from '@tanstack/react-router'
import { IpcDemo } from '../components/ipc-demo'
import { MediaDevTest } from '../components/media-dev-test'
import { useT } from '../i18n/use-t'

function HomeScreen() {
  const t = useT('home')
  return (
    <div data-testid="screen-home" className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted">{t('subtitle')}</p>
      </div>
      <IpcDemo />
      <MediaDevTest />
    </div>
  )
}

export const Route = createFileRoute('/')({
  component: HomeScreen,
})
