import type { z } from 'zod'
import { aiBatchSummarySchema } from '../channels/ai'
import { defineEvents } from '../define'

/**
 * Live batch progress, pushed from main (sub-phase 7.3).
 *
 * The same payload `ai.listBatches` returns, rather than a narrower delta. A batch changes a
 * handful of times over an hour — submitted, a few reconciliations, terminal — so there is
 * nothing to save by sending a patch, and sending the whole row means the tray never has to
 * merge two shapes or refetch to fill in a field the delta omitted.
 *
 * Unthrottled for the same reason: this is not `jobs.progress`, which fires per hashed byte.
 */
export const aiBatchSchema = aiBatchSummarySchema
export type AiBatchEvent = z.infer<typeof aiBatchSchema>

export const aiEvents = defineEvents({
  /**
   * Carries `status`, so the terminal transitions arrive here too and the renderer can drop a
   * finished row without a second channel to subscribe to.
   */
  'ai.batchProgress': aiBatchSchema,
})
