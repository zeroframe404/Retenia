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
    // The renderer has no Sentry SDK of its own (see the comment in
    // `renderer/src/main.tsx`) — it reports through the contract-validated
    // `app.reportRendererError` channel instead — so main has no use for @sentry/electron's
    // own renderer<->main transport. Left at its default (`ipcMode: IPCMode.Both`), that
    // transport registers raw `ipcMain.on('sentry-ipc.*')` channels with no sender-frame
    // check or schema validation, and injects a second `contextBridge` preload
    // (`__SENTRY_IPC__`) into every renderer session — a second, unvalidated main<->renderer
    // bridge outside `packages/ipc-contract`. `ipcMode: 0` (neither `Classic` nor
    // `Protocol`) turns off both; `getSessions: () => []` and dropping the
    // `PreloadInjection` integration are kept too, as a backstop in case `ipcMode` is ever
    // widened without noticing this comment. Neither `IPCMode` member is `0`, so there is
    // no named constant for "off" to reach for — `IPCMode.Classic & IPCMode.Protocol` is
    // the bitwise-off value, spelled out rather than a bare `0` so it survives a future
    // renumbering of the enum.
    ipcMode: Sentry.IPCMode.Classic & Sentry.IPCMode.Protocol,
    getSessions: () => [],
    integrations: (defaults) =>
      defaults.filter((integration) => integration.name !== 'PreloadInjection'),
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
