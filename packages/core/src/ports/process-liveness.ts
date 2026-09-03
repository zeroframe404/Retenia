/**
 * Whether an operating-system process is still running.
 *
 * The job scheduler needs this to tell "a worker is still chewing on that job" from "the
 * process that claimed it died and the job is stranded". Core cannot ask the OS itself, so
 * it asks through this port; the Node implementation is `process.kill(pid, 0)`.
 */
export interface ProcessLiveness {
  /** True when a process with this pid exists. A pid we are not allowed to signal still
   *  counts as alive — it exists, it just is not ours. */
  isAlive(pid: number): boolean
}
