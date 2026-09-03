import type { ProcessLiveness } from '@retenia/core'

/**
 * `process.kill(pid, 0)` — the standard "does this process exist?" probe. Signal 0 performs
 * the permission and existence checks without delivering anything.
 *
 * `EPERM` means the process exists but belongs to another user, which for our purposes is
 * still alive: what the scheduler is asking is "might something still be working on this
 * job?", and the answer there is yes.
 */
export const nodeProcessLiveness: ProcessLiveness = {
  isAlive: (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM'
    }
  },
}
