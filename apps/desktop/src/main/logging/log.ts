import { is } from '@electron-toolkit/utils'
import log from 'electron-log/main'

/**
 * electron-log setup (docs/spec/07-architecture.md §10 "Auto-update", §4 Observability).
 *
 * `log.initialize()` does three things: it patches `console.*` in the main process to also
 * write to disk, it starts the `electron-log/preload` bridge so a preload/renderer calling
 * `log.info(...)` lands in the same file, and it rotates `main.log` at 10 MB (keeping one
 * `.old` copy) with no extra config needed here.
 */
export function initLogging(): void {
  log.transports.file.level = 'info'
  // The console transport is what a `pnpm dev` terminal actually shows; a packaged build
  // has no terminal, so silencing it there just means the file is the source of truth.
  log.transports.console.level = is.dev ? 'debug' : false

  log.initialize()

  log.errorHandler.startCatching({
    onError: ({ error }) => {
      log.error('[uncaught]', error)
    },
  })
}

export { log }
