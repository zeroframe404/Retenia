import { createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { DeepLinkBanner } from './components/deep-link-banner'
import { IpcDemo } from './components/ipc-demo'
import { MediaDevTest } from './components/media-dev-test'
import { ThemeSync } from './components/theme-sync'
import { UpdateStatusLog } from './components/update-status-log'
import { useAppStore } from './store'

function HomePage() {
  const { t, i18n } = useTranslation('common')
  const ready = useAppStore((state) => state.ready)

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg text-text">
      <ThemeSync />
      <div className="flex flex-col items-center gap-2">
        <h1 className="font-display text-3xl font-semibold">{t('appTitle')}</h1>
        <p className="text-lg">{t('greeting')}</p>
        <p className="text-muted text-sm">
          {i18n.language} · {ready ? 'ready' : 'loading'}
        </p>
      </div>
      <IpcDemo />
      <MediaDevTest />
      <DeepLinkBanner />
      <UpdateStatusLog />
    </main>
  )
}

const rootRoute = createRootRoute({ component: HomePage })
const routeTree = rootRoute.addChildren([])

const memoryHistory = createMemoryHistory({ initialEntries: ['/'] })

export const router = createRouter({ routeTree, history: memoryHistory })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
