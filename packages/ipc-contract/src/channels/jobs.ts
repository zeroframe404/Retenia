import { z } from 'zod'
import { defineContract } from '../define'

/**
 * The background job queue's renderer-facing surface
 * (`docs/spec/07-architecture.md` §7).
 *
 * The renderer watches and steers the queue; it does not feed it. Real producers — ingestion,
 * path generation, exports — enqueue from main in later sub-phases, so the only way to *put*
 * work in the queue from here is the dev-gated demo channel at the bottom.
 */

/**
 * Mirrors `JOB_STATUSES` in `packages/core/src/entities/enums.ts` and the `CHECK` constraint
 * in `packages/db/src/schema/system.ts`.
 *
 * Redeclared rather than imported: this package is a leaf by architectural rule
 * (`tooling/scripts/check-deps.mjs` pins `ipc-contract: []`), so it cannot depend on
 * `@retenia/core`. `jobs.test.ts` asserts the two lists still agree.
 */
export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const
export const jobStatusSchema = z.enum(JOB_STATUSES)
export type JobStatus = z.infer<typeof jobStatusSchema>

/**
 * One row of the processing tray.
 *
 * A projection of the `jobs` table, not the row: `payload` never crosses the bridge (it can
 * hold anything an ingestion pipeline put there), and the storage columns the UI has no use
 * for — leases, `parentJobId`, the audit set — stay in main. `progress` is 0–1 rather than
 * the stored `{ value, message }` object, because a tray renders a bar, not JSON.
 */
export const jobSummarySchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  status: jobStatusSchema,
  priority: z.int(),
  /** Null while a job is queued, or while a running job has not reported yet. */
  progress: z.number().min(0).max(1).nullable(),
  progressMessage: z.string().nullable(),
  attempts: z.int(),
  maxAttempts: z.int(),
  /** The last failure's message. Survives a re-queue, so the tray can explain a retry. */
  error: z.string().nullable(),
  /** The domain row this job is about (a source, a path version…), when it has one. */
  subjectId: z.string().nullable(),
  /**
   * Small by construction — a count, a digest, a summary object. Job results are status,
   * not payload: anything large belongs in a blob with its hash recorded here.
   */
  result: z.json().nullable(),
  runAfter: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
})
export type JobSummary = z.infer<typeof jobSummarySchema>

export const jobsChannels = defineContract({
  'jobs.list': {
    input: z.object({
      /**
       * Defaults to the three the tray cares about: queued, running and failed.
       *
       * Bounded by the number of statuses that exist, because the handler issues one query
       * per entry: without a cap, a repeated status is a way to turn one call into
       * arbitrarily many synchronous reads on the main thread.
       */
      statuses: z.array(jobStatusSchema).min(1).max(JOB_STATUSES.length).optional(),
      limit: z.int().min(1).max(200).optional(),
    }),
    output: z.object({ jobs: z.array(jobSummarySchema) }),
  },

  /** Stops the job: a queued one leaves the queue, a running one has its worker aborted. */
  'jobs.cancel': {
    input: z.object({ id: z.uuid() }),
    output: jobSummarySchema,
  },

  /** Re-queues a failed or cancelled job with a fresh attempt budget. */
  'jobs.retry': {
    input: z.object({ id: z.uuid() }),
    output: jobSummarySchema,
  },

  /**
   * Queue one of the demo jobs. **Dev and E2E only** — in a packaged build it resolves
   * `{ job: null }` and queues nothing, the same shape `app.devMediaSampleUrl` uses for the
   * same reason. Nothing in the shipped product enqueues from the renderer, and a general
   * "run this kind with this payload" channel would hand a compromised renderer the ability
   * to start arbitrary background work.
   *
   * `sleep` takes its duration; `hashFile` takes none — main picks the file and reports it
   * back as `subject`, so the renderer never names a path for the main process to open.
   */
  'jobs.enqueueDemo': {
    input: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('sleep'), ms: z.int().min(0).max(120_000) }),
      z.object({ kind: z.literal('hashFile') }),
    ]),
    output: z.object({
      job: jobSummarySchema.nullable(),
      /** What `hashFile` was pointed at, so a test can verify the digest. */
      subject: z.string().nullable(),
    }),
  },
})
