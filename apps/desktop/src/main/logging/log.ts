import { is } from '@electron-toolkit/utils'
import log from 'electron-log/main'

/**
 * electron-log setup for the main process (docs/spec/07-architecture.md §4/§10).
 *
 * `log.initialize()` defaults to also injecting its own preload script and an
 * `ipcRenderer.send('__ELECTRON_LOG__', …)` channel so a renderer can call `log.info(...)`
 * directly — that is a second, unvalidated main↔renderer bridge outside
 * `packages/ipc-contract`, which CLAUDE.md rules out ("All main↔renderer communication
 * goes through packages/ipc-contract... never raw ipcRenderer"). `preload: false` keeps
 * this to what main actually needs: patching `console.*` here and rotating the file. A
 * renderer error still reaches this log — see `app.reportRendererError` in
 * `src/main/ipc/handlers.ts`, which is contract-validated.
 */
export function initLogging(): void {
  log.transports.file.level = 'info'
  log.transports.file.maxSize = 10 * 1024 * 1024
  // The console transport is what a `pnpm dev` terminal actually shows; a packaged build
  // has no terminal, so silencing it there just means the file is the source of truth.
  log.transports.console.level = is.dev ? 'debug' : false

  log.initialize({ preload: false, spyRendererConsole: false })

  log.errorHandler.startCatching({
    onError: ({ error }) => {
      log.error('[uncaught]', error)
    },
  })
}

export { log }
