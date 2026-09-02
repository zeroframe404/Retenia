import { createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { IpcDemo } from './components/ipc-demo'
import { useAppStore } from './store'

function HomePage() {
  const { t, i18n } = useTranslation('common')
  const ready = useAppStore((state) => state.ready)

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-50">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-3xl font-semibold">{t('appTitle')}</h1>
        <p className="text-lg">{t('greeting')}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {i18n.language} · {ready ? 'ready' : 'loading'}
        </p>
      </div>
      <IpcDemo />
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
