import { z } from 'zod'
import { defineContract } from '../define'

/**
 * The memory system's renderer-facing surface: per-item importance, the per-card override
 * that urgent mode rides on, the priority-bias guard, and the simulate-then-confirm pair
 * behind "reschedule now" (`docs/spec/02-memory-system.md` §7).
 *
 * Three domains in one file because they are one feature. The `domain.action` names are
 * what `window.api.<domain>.<action>` is generated from, so `items.*`, `cards.*` and
 * `memory.*` each get their own namespace on the bridge.
 */

/**
 * Mirrors `IMPORTANCE_LEVELS` in `packages/core/src/entities/enums.ts` and the `CHECK`
 * constraints `packages/db` builds on `knowledge_items.importance` and
 * `cards.importance_override`.
 *
 * Redeclared rather than imported: this package is a leaf by architectural rule
 * (`tooling/scripts/check-deps.mjs` pins `ipc-contract: []`), so it cannot depend on
 * `@retenia/core`. `memory.test.ts` asserts the lists still agree.
 */
export const IMPORTANCE_LEVELS = ['urgent', 'high', 'normal', 'maintenance', 'paused'] as const
export const importanceLevelSchema = z.enum(IMPORTANCE_LEVELS)
export type ImportanceLevel = z.infer<typeof importanceLevelSchema>

/** §7 rule 5: urgent mode lasts 48 or 72 hours, and nothing else. */
export const URGENT_MODE_HOURS = [48, 72] as const
export const urgentModeHoursSchema = z.union([z.literal(48), z.literal(72)])

/**
 * Bounded on purpose. Every one of these channels turns an id into a row write, so an
 * unbounded array is a way to turn one call into arbitrarily many synchronous writes on the
 * main thread — the same reasoning as `jobs.list`'s status cap.
 */
const idList = z.array(z.uuid()).min(1).max(500)

export const importanceMixEntrySchema = z.object({
  level: importanceLevelSchema,
  items: z.int().nonnegative(),
  cards: z.int().nonnegative(),
  /** Share of the non-paused item total. `0` when there is nothing yet, never `NaN`. */
  share: z.number().min(0).max(1),
})

/** §7 rule 4's guard: "if everything is urgent, nothing is." */
export const importanceMixSchema = z.object({
  entries: z.array(importanceMixEntrySchema),
  totalItems: z.int().nonnegative(),
  totalCards: z.int().nonnegative(),
  prioritizedShare: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  biasWarning: z.boolean(),
  computedAt: z.iso.datetime(),
})
export type ImportanceMix = z.infer<typeof importanceMixSchema>

const rescheduleWindowSchema = z.object({
  before: z.number(),
  after: z.number(),
  delta: z.number(),
})

export const rescheduleChangeSchema = z.object({
  cardId: z.uuid(),
  level: importanceLevelSchema,
  currentDue: z.iso.datetime(),
  newDue: z.iso.datetime(),
  currentIntervalDays: z.int().nonnegative(),
  newIntervalDays: z.int().min(1),
  deltaDays: z.int(),
  desiredRetention: z.number().min(0).max(1),
})

/**
 * What applying a level change *would* cost — the summary the confirmation dialog shows
 * before anything is written (§7 rule 2).
 */
export const rescheduleImpactSchema = z.object({
  affected: z.int().nonnegative(),
  skipped: z.object({
    notInReview: z.int().nonnegative(),
    noMemoryState: z.int().nonnegative(),
    unchanged: z.int().nonnegative(),
  }),
  dueInSevenDays: rescheduleWindowSchema,
  reviewsPerDay: rescheduleWindowSchema,
  byLevel: z.record(
    importanceLevelSchema,
    z.object({ affected: z.int().nonnegative(), dueInSevenDaysDelta: z.int() }),
  ),
  changes: z.array(rescheduleChangeSchema),
  computedAt: z.iso.datetime(),
})
export type RescheduleImpact = z.infer<typeof rescheduleImpactSchema>

/** Which cards to project. Omit everything and it is every live, queued card. */
export const rescheduleSelectionSchema = z.object({
  cardIds: idList.optional(),
  itemIds: idList.optional(),
  levels: z.array(importanceLevelSchema).min(1).max(IMPORTANCE_LEVELS.length).optional(),
  limit: z.int().min(1).max(20_000).optional(),
})

export const memoryChannels = defineContract({
  /**
   * Set the importance of many items at once. Moves no due date: the new desired retention
   * applies from the next review (§7 rule 2). `memory.simulateReschedule` is how the user
   * asks what applying it now would cost.
   */
  'items.setImportance': {
    input: z.object({ ids: idList, level: importanceLevelSchema }),
    output: z.object({ updated: z.int().nonnegative() }),
  },

  /**
   * The per-card override, which beats the item's level. `level: null` clears it.
   *
   * `expiresAt` makes the override temporary — that is what urgent mode is. Prefer
   * `memory.startUrgentMode`, which takes items and applies §7 rule 5's window; this
   * channel is the general form.
   */
  'cards.overrideImportance': {
    input: z.object({
      ids: idList,
      level: importanceLevelSchema.nullable(),
      expiresAt: z.iso.datetime().nullable().optional(),
    }),
    output: z.object({ updated: z.int().nonnegative() }),
  },

  /** §7 rule 4: the share per level, and whether urgent + high has passed ~30 %. */
  'memory.importanceMix': {
    input: z.void(),
    output: importanceMixSchema,
  },

  /** Read-only by construction in main: it cannot write, only project. */
  'memory.simulateReschedule': {
    input: rescheduleSelectionSchema,
    output: rescheduleImpactSchema,
  },

  /**
   * Apply what `memory.simulateReschedule` projected.
   *
   * `z.literal(true)` puts the confirmation in the *schema*: an unconfirmed apply is
   * rejected at the bridge and never reaches the handler at all.
   */
  'memory.rescheduleNow': {
    input: rescheduleSelectionSchema.extend({ confirm: z.literal(true) }),
    output: z.object({
      impact: rescheduleImpactSchema,
      applied: z.int().nonnegative(),
    }),
  },

  /** §7 rule 5: desired retention 0.97, same-day steps and the final drill, for 48 or 72 h. */
  'memory.startUrgentMode': {
    input: z.object({ itemIds: idList, hours: urgentModeHoursSchema.optional() }),
    output: z.object({
      items: z.int().nonnegative(),
      cards: z.int().nonnegative(),
      expiresAt: z.iso.datetime(),
    }),
  },
})
