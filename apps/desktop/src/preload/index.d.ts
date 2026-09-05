import type { RendererApi } from '@retenia/ipc-contract'

declare global {
  interface Window {
    /** Generated from `packages/ipc-contract`; see `apps/desktop/src/preload/build-api.ts`. */
    api: RendererApi
    /**
     * The one bridge deliberately outside the generated contract: `webUtils.getPathForFile`
     * is synchronous and per-`File`, not a request/response IPC round trip, so it does not
     * fit `defineContract`. Kept on its own global (not `window.api`) so the contract-typed
     * surface stays exactly `RendererApi` — see `apps/desktop/src/preload/index.ts`.
     */
    retenia: {
      /** The absolute path of a `File` the user actually dropped — used for drag-and-drop
       *  import into the Library (sub-phase 6.1). Throws for a `File` not backed by a real
       *  path (e.g. one constructed in script), which cannot happen from a real OS drop. */
      getPathForFile(file: File): string
    }
  }
}
