import { z } from 'zod'
import { defineContract } from '../define'
import { jobSummarySchema } from './jobs'
import { importanceLevelSchema } from './memory'

/**
 * The Settings → Scheduler surface (`docs/spec/08-ux.md` §2, `02-memory-system.md` §6, §16):
 * the FSRS parameters in force, the optimizer that trains them, the per-level desired
 * retention, and the sibling dispersal of §4.
 *
 * What is deliberately **not** here is the simulator. §6's workload projection is pure code
 * in `packages/core` and runs in the renderer, so the retention slider recomputes on every
 * drag with no round trip; a channel for it would be a second implementation path and a
 * frame of latency per pixel.
 */

/** Mirrors `LEECH_ACTIONS` in `packages/core/src/entities/enums.ts`. Redeclared because this
 *  package is a leaf (`tooling/scripts/check-deps.mjs`); `scheduler.test.ts` pins the two
 *  lists together. */
export const LEECH_ACTIONS = ['warn', 'warn_rewrite', 'edit', 'suspend', 'none'] as const
export const leechActionSchema = z.enum(LEECH_ACTIONS)

/** A learning step as `ts-fsrs` spells it: `1m`, `10m`, `1h`. §4: short steps, and never
 *  a step of a day or more with FSRS. */
export const stepSchema = z.string().regex(/^\d{1,4}[mh]$/)
export const stepsSchema = z.array(stepSchema).max(8)

export const evaluationSchema = z.object({
  logLoss: z.number(),
  rmse: z.number(),
})

export const schedulerProfileSchema = z.object({
  scope: z.string(),
  algorithm: z.string(),
  w: z.array(z.number()).length(21),
  decay: z.number().nullable(),
  learningSteps: stepsSchema,
  relearningSteps: stepsSchema,
  enableFuzz: z.boolean(),
  enableShortTerm: z.boolean(),
  maximumInterval: z.int().positive(),
  dayStartHour: z.int().min(0).max(23),
  /** Null until the first accepted optimization — "never optimized" in the UI. */
  trainedAt: z.iso.datetime().nullable(),
  nReviews: z.int().nonnegative().nullable(),
  logLoss: z.number().nullable(),
  rmse: z.number().nullable(),
})

export const optimizerStatusSchema = z.object({
  profile: schedulerProfileSchema,
  /** Live, non-manual reviews available to train on. */
  nReviews: z.int().nonnegative(),
  offer: z.object({
    offered: z.boolean(),
    reason: z.enum(['first', 'reviews', 'monthly']).nullable(),
    nextThresholdReviews: z.int().positive(),
  }),
})

export const optimizationOutcomeSchema = z.object({
  applied: z.boolean(),
  reason: z.enum(['improved', 'log_loss_not_better']),
  before: evaluationSchema,
  after: evaluationSchema,
  profile: schedulerProfileSchema,
})

export const schedulerChannels = defineContract({
  /** The model in force and its quality — §13's "log loss / RMSE and the date of the last
   *  optimization". */
  'scheduler.status': {
    input: z.void(),
    output: optimizerStatusSchema,
  },

  /**
   * Queue a training run. The dialog then follows `jobs.progress` like any other job.
   *
   * Its own channel rather than a generic enqueue: `jobs.enqueueDemo` is dev/E2E-gated on
   * purpose, and nothing in the shipped product lets the renderer name a job kind.
   */
  'scheduler.optimize': {
    input: z.void(),
    output: z.object({ job: jobSummarySchema, nReviews: z.int().positive() }),
  },

  /**
   * Keep what a finished run produced, if §16's health check accepts it.
   *
   * `z.literal(true)` puts the confirmation in the schema, as `memory.rescheduleNow` does:
   * the user sees the before/after numbers and decides. Applying writes parameters only —
   * no card moves, because §7 rule 2 and §16 both forbid a mass reschedule.
   */
  'scheduler.applyOptimization': {
    input: z.object({ jobId: z.uuid(), confirm: z.literal(true) }),
    output: optimizationOutcomeSchema,
  },

  /** The steps, fuzz and interval cap the profile carries. Not settings keys: they are
   *  `scheduler_profiles` columns, and two homes for one value is how they drift. */
  'scheduler.updateProfile': {
    input: z
      .object({
        learningSteps: stepsSchema.optional(),
        relearningSteps: stepsSchema.optional(),
        enableFuzz: z.boolean().optional(),
        maximumInterval: z.int().min(1).max(36_500).optional(),
      })
      .refine((patch) => Object.keys(patch).length > 0, { message: 'nothing to update' }),
    output: schedulerProfileSchema,
  },

  /**
   * Tune one importance level (§7): its desired retention, interval cap and leech policy.
   *
   * Retention is bounded by §6's allowed range, not the recommended one — a user who wants
   * 0.99 may have it, with the simulated workload shown next to the slider.
   */
  'scheduler.setLevel': {
    input: z
      .object({
        level: importanceLevelSchema,
        desiredRetention: z.number().min(0.7).max(0.99).nullable().optional(),
        maxIntervalDays: z.int().min(1).max(36_500).nullable().optional(),
        leechThreshold: z.int().min(1).max(99).optional(),
        leechAction: leechActionSchema.optional(),
      })
      .refine((patch) => Object.keys(patch).length > 1, { message: 'nothing to update' }),
    output: z.object({ updated: z.boolean() }),
  },

  /** §4's "disperse siblings": spread one item's cards onto different days. Moves due dates
   *  only — logged as rating 0, so S and D are untouched. */
  'cards.disperseSiblings': {
    input: z.object({ itemId: z.uuid(), confirm: z.literal(true) }),
    output: z.object({ moved: z.int().nonnegative() }),
  },
})
