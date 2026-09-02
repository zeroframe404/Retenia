import type { RendererApi } from '@retenia/ipc-contract'

declare global {
  interface Window {
    /** Generated from `packages/ipc-contract`; see `apps/desktop/src/preload/build-api.ts`. */
    api: RendererApi
  }
}
