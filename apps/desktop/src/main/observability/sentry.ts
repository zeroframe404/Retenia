import * as Sentry from '@sentry/electron/main'

/**
 * Crash reporting, opt-in only (docs/spec/07-architecture.md §2/§10): off by default until
 * the user consents in onboarding (`Settings.telemetryEnabled`, sub-phase 13.5). The DSN is
 * read from `process.env.SENTRY_DSN` at launch; nothing sets that env var yet (a real
 * install would need it baked into the build), so this silently no-ops rather than failing
 * until that lands.
 *
 * No PII and no content: `beforeSend`/`beforeBreadcrumb` strip anything that could carry
 * study material, file paths outside the app, or the user's IP.
 */
export function initSentryMain(enabled: boolean): void {
  if (!enabled || !process.env.SENTRY_DSN) {
    return
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    sendDefaultPii: false,
    beforeSend(event) {
      delete event.user
      delete event.request
      return event
    },
    beforeBreadcrumb(breadcrumb) {
      // Console/HTTP breadcrumbs are the likeliest place study content or file paths leak
      // in; everything else (navigation, UI clicks) is harmless.
      if (breadcrumb.category === 'console' || breadcrumb.category === 'http') {
        return null
      }
      return breadcrumb
    },
  })
}
