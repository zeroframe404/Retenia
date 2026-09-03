import { z } from 'zod'
import { jobStatusSchema } from '../channels/jobs'
import { defineEvents } from '../define'

/**
 * Live job progress, pushed from main (`docs/spec/07-architecture.md` §7).
 *
 * The spec writes the channel as `jobs:progress`; this repository names every push
 * `domain.action` with a dot (`app.themeChanged`), and `build-api.ts` splits on that dot to
 * generate the surface, so it is declared as `jobs.progress`.
 *
 * Main throttles these to 10 Hz per job, coalescing anything faster and always flushing the
 * last value — so a listener sees a smooth bar without a message per byte hashed.
 */
export const jobProgressSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  status: jobStatusSchema,
  /** Null when a job is queued, or running but yet to report. */
  progress: z.number().min(0).max(1).nullable(),
  message: z.string().nullable(),
  error: z.string().nullable(),
})
export type JobProgressEvent = z.infer<typeof jobProgressSchema>

export const jobsEvents = defineEvents({
  /**
   * Carries `status`, so the terminal transitions arrive here too and the renderer can drop
   * a finished row and refresh its list without a second channel to subscribe to.
   */
  'jobs.progress': jobProgressSchema,
})
