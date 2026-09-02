import type { Contract } from '@retenia/ipc-contract'
import { app } from 'electron'
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
}
