import { z } from 'zod'
import { defineContract } from '../define'

/**
 * The AI layer's renderer-facing surface: today, submitted Batch API jobs
 * (`docs/spec/06-ai-providers.md` §2), so the processing tray can show what a generation run
 * is waiting on and offer to stop it.
 *
 * The renderer watches and cancels; it never submits. Batches are started from main by the
 * features that need them (Phase 8's path expansion is the first), for the same reason
 * `jobs.enqueueDemo` is the only way to put work in the job queue from here: a general
 * "spend money on these forty prompts" channel would hand a compromised renderer the app's
 * whole monthly budget.
 */

/**
 * Mirrors `AI_BATCH_STATUSES` in `packages/core/src/entities/enums.ts` and the `CHECK` in
 * `packages/db/src/schema/system.ts`.
 *
 * Redeclared rather than imported: this package is a leaf by architectural rule
 * (`tooling/scripts/check-deps.mjs` pins `ipc-contract: []`). `ai.test.ts` asserts the two
 * lists still agree.
 */
export const AI_BATCH_STATUSES = [
  'submitting',
  'submitted',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
] as const
export const aiBatchStatusSchema = z.enum(AI_BATCH_STATUSES)
export type AiBatchStatus = z.infer<typeof aiBatchStatusSchema>

/**
 * One batch, as the tray sees it.
 *
 * A projection, not the row. What is deliberately missing is `providerBatchId` — an
 * account-scoped handle on the provider's side, which the renderer has no use for and cannot
 * act on — along with `stage`, `role` and the polling columns, which describe how main does
 * its work rather than what the user is waiting for.
 */
export const aiBatchSummarySchema = z.object({
  id: z.uuid(),
  /** The profile id: `anthropic`, `google`… */
  provider: z.string(),
  model: z.string(),
  /** The feature that submitted it, for the tray's label: `expand_lesson`, `item_bank`… */
  purpose: z.string(),
  status: aiBatchStatusSchema,
  requestCount: z.int().nonnegative(),
  succeededCount: z.int().nonnegative(),
  failedCount: z.int().nonnegative(),
  /** What it was quoted at before submission — the "~USD 1.10" of the tray row. */
  costEstimateUsd: z.number().nonnegative(),
  /** What the reconciled calls have actually come to so far. */
  costUsd: z.number().nonnegative(),
  submittedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  error: z.string().nullable(),
})
export type AiBatchSummary = z.infer<typeof aiBatchSummarySchema>

export const aiChannels = defineContract({
  /** Every batch still in flight, oldest first — what the tray renders on mount. */
  'ai.listBatches': {
    input: z.object({}),
    output: z.object({ batches: z.array(aiBatchSummarySchema) }),
  },

  /**
   * Stop a batch: the provider is asked to cancel, and the row moves either way.
   *
   * "Either way" is the honest behaviour rather than a shortcut. A provider that will not
   * take the cancellation still finishes the job and still charges for it; leaving the row
   * running because the request failed would only make the tray lie about it.
   */
  'ai.cancelBatch': {
    input: z.object({ id: z.uuid() }),
    output: aiBatchSummarySchema.nullable(),
  },
})
