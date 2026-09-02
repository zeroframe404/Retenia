import { Toaster } from '@retenia/ui'
import { createRootRoute } from '@tanstack/react-router'
import { HotkeysProvider } from 'react-hotkeys-hook'
import { DeepLinkBanner } from '../components/deep-link-banner'
import { ThemeSync } from '../components/theme-sync'
import { UpdateStatusLog } from '../components/update-status-log'
import { AppShell } from '../shell/app-shell'
import { NotFound } from '../shell/not-found'

function RootLayout() {
  return (
    <HotkeysProvider initiallyActiveScopes={['global']}>
      <ThemeSync />
      <AppShell />
      {/* Global, route-independent widgets — reachable no matter which section is active. */}
      <div className="fixed right-2 bottom-2 z-40">
        <DeepLinkBanner />
      </div>
      <UpdateStatusLog />
      <Toaster />
    </HotkeysProvider>
  )
}

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
})
