/**
 * The `jobs.locked_by` encoding.
 *
 * The column is free-form text, and the obvious thing to put there is the worker's own id.
 * That is not enough for what startup has to do — re-queue "jobs `running` with a dead
 * `locked_by` PID" (`docs/spec/07-architecture.md` §7) — so the lease also names the
 * operating-system process holding it, and `JobScheduler.recoverOrphans` can ask
 * `ProcessLiveness` about that pid rather than only waiting out a lease timeout.
 *
 * It carries a third part as well: the id of the *application run* that took it. A pid alone
 * is ambiguous, because the OS reuses pids — a crashed worker's number can belong to some
 * unrelated program by the time the app restarts, and the liveness check would then answer
 * "alive" about a process that never held the job, stranding it. The run id has no such
 * ambiguity: a lease that does not name the current run is, by construction, from a run that
 * is over, whatever its pid says.
 */

export interface WorkerLease {
  /** The application run that took this lease. New on every launch. */
  runId: string
  /** The OS process of the worker holding the job. */
  pid: number
  /** Which worker slot within that run. */
  workerId: string
}

const PREFIX = 'w1'

const isSafePart = (value: string): boolean => value.length > 0 && !value.includes(':')

/** `w1:<runId>:<pid>:<workerId>`. */
export function formatWorkerId(lease: WorkerLease): string {
  if (!Number.isInteger(lease.pid) || lease.pid <= 0) {
    throw new Error(`A worker lease needs a positive integer pid, got ${lease.pid}`)
  }
  if (!isSafePart(lease.runId)) {
    throw new Error(`A run id must be non-empty and contain no ":", got "${lease.runId}"`)
  }
  if (!isSafePart(lease.workerId)) {
    throw new Error(`A worker id must be non-empty and contain no ":", got "${lease.workerId}"`)
  }
  return `${PREFIX}:${lease.runId}:${lease.pid}:${lease.workerId}`
}

/**
 * Read a lease back. Returns undefined for anything that is not one — a null column, a lease
 * written by an older version of the app, or a value some other tool put there. Callers treat
 * "not a lease we understand" the same as "dead", which is the safe direction: the worst case
 * is re-running a job, which the queue is already built to do.
 */
export function parseWorkerId(value: string | null | undefined): WorkerLease | undefined {
  if (typeof value !== 'string') return undefined
  const parts = value.split(':')
  if (parts.length !== 4) return undefined
  const [prefix, runId, rawPid, workerId] = parts
  if (prefix !== PREFIX) return undefined
  if (runId === undefined || !isSafePart(runId)) return undefined
  if (workerId === undefined || !isSafePart(workerId)) return undefined
  if (rawPid === undefined || !/^\d+$/.test(rawPid)) return undefined
  const pid = Number(rawPid)
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
  return { runId, pid, workerId }
}
