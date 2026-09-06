import type { ChannelName, EventName, IpcResult } from '@retenia/ipc-contract'
import { contextBridge, ipcRenderer } from 'electron'
import { buildApi } from './build-api'

if (!process.contextIsolated) {
  // Without context isolation the bridge is decorative: the renderer shares a JS context
  // with the preload. Failing loudly beats exposing an API that pretends to be a boundary.
  throw new Error('Retenia requires contextIsolation: refusing to expose window.api')
}

const api = buildApi({
  invoke: (channel: ChannelName, input: unknown) =>
    ipcRenderer.invoke(channel, input) as Promise<IpcResult<unknown>>,

  subscribe: (event: EventName, listener: (payload: unknown) => void) => {
    // The Electron event object is deliberately not forwarded: it carries `sender`, which
    // is a route back to the full IPC surface.
    const wrapped = (_event: unknown, payload: unknown) => listener(payload)
    ipcRenderer.on(event, wrapped)
    return () => {
      ipcRenderer.off(event, wrapped)
    }
  },
})

// Only the generated API is exposed — never `ipcRenderer`, and no `window.electron`.
contextBridge.exposeInMainWorld('api', api)
