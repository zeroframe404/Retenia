import { MotionConfig, Toaster, useApplyTypography } from '@retenia/ui'
import { createRootRoute } from '@tanstack/react-router'
import { HotkeysProvider } from 'react-hotkeys-hook'
import { DeepLinkBanner } from '../components/deep-link-banner'
import { ThemeSync } from '../components/theme-sync'
import { UpdateStatusLog } from '../components/update-status-log'
import { useT } from '../i18n/use-t'
import { AppShell } from '../shell/app-shell'
import { NotFound } from '../shell/not-found'

function RootLayout() {
  const t = useT('shell')
  useApplyTypography()

  return (
    // `reducedMotion="user"` makes every `packages/ui/src/motion.ts` preset respect the OS
    // "reduce motion" setting app-wide (docs/spec/08-ux.md §1 accessibility) — Storybook's
    // preview already wraps stories the same way, this is the one place the real app needed it.
    <MotionConfig reducedMotion="user">
      <HotkeysProvider initiallyActiveScopes={['global']}>
        {/* WCAG 2.2 SC 2.4.1 Bypass Blocks — first focusable element in the document,
         * visually hidden until it receives keyboard focus. */}
        <a
          href="#main-content"
          className="bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-800 fixed top-2 left-2 z-50 -translate-y-16 rounded-md px-4 py-2 text-sm font-medium text-white transition-transform duration-fast ease-standard focus:translate-y-0"
        >
          {t('skipToContent')}
        </a>
        <ThemeSync />
        <AppShell />
        {/* Global, route-independent widgets — reachable no matter which section is active. */}
        <div className="fixed right-2 bottom-2 z-40">
          <DeepLinkBanner />
        </div>
        <UpdateStatusLog />
        <Toaster />
      </HotkeysProvider>
    </MotionConfig>
  )
}

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
})
