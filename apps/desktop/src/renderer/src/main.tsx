import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import { router } from './router'
import './styles.css'

const queryClient = new QueryClient()

/**
 * Crash reporting for the renderer (docs/spec/07-architecture.md §4/§10). The preload only
 * ever exposes the generated IPC contract (`buildApi`) — never a second, Sentry-specific
 * bridge — so instead of running its own SDK instance in this process, the renderer reports
 * through `app.reportRendererError` and the already-initialized main-process Sentry client
 * (`src/main/observability/sentry.ts`) decides whether to send it, based on the same
 * opt-in flag. A malformed report is not worth its own error handling loop.
 */
function reportRendererError(error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error))
  window.api.app
    .reportRendererError({
      name: normalized.name,
      message: normalized.message,
      stack: normalized.stack,
    })
    .catch(() => {})
}

window.addEventListener('error', (event) => reportRendererError(event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => reportRendererError(event.reason))

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
