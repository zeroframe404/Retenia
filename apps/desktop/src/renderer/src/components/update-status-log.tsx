import { useIpcEvent } from '../ipc/hooks'

/**
 * No UI of its own yet (a real "update available" banner/toast is a later UX sub-phase) —
 * this just proves `app.updateStatus` reaches the renderer, by putting every status change
 * in the console/devtools log electron-log also captures (sub-phase 1.4 acceptance:
 * "update events appear in the renderer log").
 */
export function UpdateStatusLog() {
  useIpcEvent('app.updateStatus', (status) => {
    console.log('[update]', status)
  })

  return null
}
