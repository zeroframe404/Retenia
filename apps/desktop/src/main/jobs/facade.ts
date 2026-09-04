import type { JobScheduler, JobStatus } from '@retenia/core'
import type { JobSummary } from '@retenia/ipc-contract'
import { getDevMediaSamplePath } from '../paths'
import type { JobRunner } from './runner'
import { toJobSummary } from './to-summary'

/**
 * What the IPC handlers call. A thin seam over the scheduler and the runner, so
 * `handlers.ts` stays a list of one-liners and this can be faked in its tests.
 */
export interface JobsFacade {
  list(input: { statuses?: JobStatus[]; limit?: number }): Promise<JobSummary[]>
  /** One job by id — what a channel that queued its own job returns, and what the
   *  optimizer's result dialog polls. `null` when the id is unknown. */
  find(id: string): Promise<JobSummary | null>
  cancel(id: string): Promise<JobSummary>
  retry(id: string): Promise<JobSummary>
  enqueueDemo(
    input: { kind: 'sleep'; ms: number } | { kind: 'hashFile' },
  ): Promise<{ job: JobSummary | null; subject: string | null }>
}

export interface JobsFacadeDeps {
  scheduler: JobScheduler
  runner: JobRunner
  /** Whether `jobs.enqueueDemo` will queue anything. False in a packaged build. */
  demoEnabled: boolean
}

/** What the tray asks for when it names no statuses of its own. */
const TRAY_STATUSES: JobStatus[] = ['queued', 'running', 'failed']
const DEFAULT_LIMIT = 50

export function createJobsFacade({ scheduler, runner, demoEnabled }: JobsFacadeDeps): JobsFacade {
  return {
    /**
     * One query per status, merged and re-sorted here.
     *
     * Two bounds matter, because `better-sqlite3` reads synchronously on main's thread and a
     * slow `jobs.list` stalls the UI, the IPC loop and the claim loop alike. The statuses are
     * de-duplicated so a repeated entry cannot multiply the query count (the contract also
     * caps the array length), and `limit` is pushed into each query rather than applied after
     * the fact — `succeeded` and `failed` rows are soft-deleted, never purged, so an
     * unbounded read grows with the lifetime of the install.
     *
     * Each query fetches `limit` rows so the merge still has enough to choose from: the
     * top `limit` overall can all come from one status.
     */
    list: async ({ statuses = TRAY_STATUSES, limit = DEFAULT_LIMIT }) => {
      const distinct = [...new Set(statuses)]
      const byStatus = await Promise.all(
        distinct.map((status) => scheduler.listByStatus(status, { limit })),
      )
      return byStatus
        .flat()
        .sort(
          (a, b) =>
            b.priority - a.priority ||
            a.createdAt.getTime() - b.createdAt.getTime() ||
            a.id.localeCompare(b.id),
        )
        .slice(0, limit)
        .map(toJobSummary)
    },

    find: async (id) => {
      const job = await scheduler.find(id)
      return job === undefined ? null : toJobSummary(job)
    },

    cancel: async (id) => toJobSummary(await runner.cancel(id)),

    retry: async (id) => toJobSummary(await runner.retry(id)),

    /**
     * Dev and E2E only. In a packaged build this queues nothing and resolves nulls, the same
     * shape (and for the same reason) as `app.devMediaSampleUrl`.
     *
     * `hashFile` is pointed at a file main chooses. The renderer never names a path: a
     * channel that let it would be handing a compromised renderer an arbitrary-file-read
     * oracle, since the digest comes back across the bridge.
     */
    enqueueDemo: async (input) => {
      if (!demoEnabled) return { job: null, subject: null }

      if (input.kind === 'sleep') {
        const job = await scheduler.enqueue('sleep', { ms: input.ms })
        runner.kick()
        return { job: toJobSummary(job), subject: null }
      }

      const path = getDevMediaSamplePath()
      const job = await scheduler.enqueue('hashFile', { path })
      runner.kick()
      return { job: toJobSummary(job), subject: path }
    },
  }
}
