import { is } from '@electron-toolkit/utils'
import type { Contract } from '@retenia/ipc-contract'
import { app } from 'electron'
import { ensureDevMediaSample } from '../dev/media-sample'
import { getBlobsRoot, getDevMediaSamplePath } from '../paths'
import type { Handlers } from './register-handlers'

/** The implementation of every channel in the contract. */
export const handlers: Handlers<Contract> = {
  'app.getVersion': () => ({
    app: app.getVersion(),
    electron: process.versions.electron ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    node: process.versions.node ?? 'unknown',
  }),

  'app.ping': ({ sentAt }) => ({
    sentAt,
    receivedAt: new Date().toISOString(),
  }),

  'app.devMediaSampleUrl': () => {
    if (!is.dev) {
      return { url: null }
    }
    return { url: ensureDevMediaSample(getDevMediaSamplePath(), getBlobsRoot()) }
  },
}
