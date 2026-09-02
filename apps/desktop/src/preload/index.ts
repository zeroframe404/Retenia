import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge } from 'electron'

// The typed `window.api.*` surface generated from `packages/ipc-contract` lands in
// sub-phase 1.2 (see `.claude/skills/add-ipc-channel/SKILL.md`). For now only the
// generic electron-toolkit helpers are exposed — never raw `ipcRenderer`.
const api = {}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error - define in preload.d.ts when contextIsolation is enabled (the default)
  window.electron = electronAPI
  // @ts-expect-error - define in preload.d.ts when contextIsolation is enabled (the default)
  window.api = api
}
