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

/**
 * The ceiling on a temporary override's window. Urgent mode itself is 48 or 72 hours; the
 * general form allows longer for a level that is not `urgent`, but never indefinitely —
 * a temporary override with no real end is a permanent one wearing a disguise.
 */
export const MAX_OVERRIDE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

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

/**
 * How many cards one projection may cover.
 *
 * `limit` has a **default**, not just a ceiling: every field of the selection is optional,
 * so `{}` is a legal input, and without a default it would mean "every live card" — one
 * synchronous read of the whole table on the main thread, and, for `rescheduleNow`, one
 * transaction writing four rows per card. The default is generous enough that a real
 * "reschedule everything" is one call, and bounded enough that it cannot wedge the process.
 */
export const RESCHEDULE_LIMIT_DEFAULT = 2_000
export const RESCHEDULE_LIMIT_MAX = 20_000

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
  changes: z.array(rescheduleChangeSchema).max(RESCHEDULE_LIMIT_MAX),
  computedAt: z.iso.datetime(),
})
export type RescheduleImpact = z.infer<typeof rescheduleImpactSchema>

/** Which cards to project. Omit everything and it is the first `RESCHEDULE_LIMIT_DEFAULT`
 *  live, queued cards. */
export const rescheduleSelectionSchema = z.object({
  cardIds: idList.optional(),
  itemIds: idList.optional(),
  levels: z.array(importanceLevelSchema).min(1).max(IMPORTANCE_LEVELS.length).optional(),
  limit: z.int().min(1).max(RESCHEDULE_LIMIT_MAX).default(RESCHEDULE_LIMIT_DEFAULT),
})

/**
 * §13's "Forecast" row: *"Cards and minutes per day at 30/90 days, per level, with and
 * without new."*
 *
 * Not §6's workload simulation, which projects a year under a given desired retention and
 * needs `fsrs-rs`. This one counts what is already scheduled, so the `withNew` figures add
 * the introductions the quota allows but not the reviews those will later generate.
 */
export const forecastDaySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Days from today; `0` is today. */
  offset: z.int().nonnegative(),
  byLevel: z.record(importanceLevelSchema, z.int().nonnegative()),
  cards: z.int().nonnegative(),
  minutes: z.number().nonnegative(),
  newCards: z.int().nonnegative(),
  cardsWithNew: z.int().nonnegative(),
  minutesWithNew: z.number().nonnegative(),
})

export const forecastSchema = z.object({
  days: z.array(forecastDaySchema),
  medianSecondsPerCard: z.number().positive(),
  /** Cards already overdue, counted into day 0 so today matches what the session offers. */
  backlog: z.int().nonnegative(),
  newPool: z.int().nonnegative(),
  dailyNewLimit: z.int().nonnegative(),
  generatedAt: z.iso.datetime(),
})
export type Forecast = z.infer<typeof forecastSchema>

/** A quarter is the longest window §13 asks for; the cap keeps one call bounded. */
export const FORECAST_MAX_DAYS = 365

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
   * `expiresAt` makes the override temporary. It is bounded and must lie in the future:
   * an unbounded expiry on the `urgent` level would be a *permanent* desired retention of
   * 0.97, which is exactly what §7 rule 5 says urgent mode must never be, and which no
   * sweep would ever clear. For urgent mode proper, prefer `memory.startUrgentMode`, which
   * applies §7's 48/72-hour window; this channel is the general form.
   */
  'cards.overrideImportance': {
    input: z
      .object({
        ids: idList,
        level: importanceLevelSchema.nullable(),
        expiresAt: z.iso.datetime().nullable().optional(),
      })
      .refine(({ level, expiresAt }) => level !== null || expiresAt == null, {
        message: 'expiresAt is meaningless when the override is being cleared',
        path: ['expiresAt'],
      })
      .refine(
        ({ expiresAt }) => {
          if (expiresAt == null) return true
          const at = Date.parse(expiresAt) - Date.now()
          return at > 0 && at <= MAX_OVERRIDE_WINDOW_MS
        },
        {
          message: 'expiresAt must be in the future and at most 30 days out',
          path: ['expiresAt'],
        },
      ),
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

  /** §13: cards and minutes per day, per level, with and without new. Read-only. */
  'memory.forecast': {
    input: z.object({ days: z.int().min(1).max(FORECAST_MAX_DAYS) }),
    output: forecastSchema,
  },

  /** §7 rule 5: desired retention 0.97, same-day steps and the final drill, for 48 or 72 h. */
  'memory.startUrgentMode': {
    input: z.object({ itemIds: idList, hours: urgentModeHoursSchema.optional() }),
    output: z.object({
      items: z.int().nonnegative(),
      cards: z.int().nonnegative(),
      expiresAt: z.iso.datetime(),
      /** The selection held more cards than one call applies; the rest were left alone. */
      truncated: z.boolean(),
    }),
  },

  /**
   * Marks (or clears) the manual leech flag from the review screen's "Mark as leech / lower
   * importance" menu (§4, §7's per-level leech action). Lowering importance itself is
   * `cards.overrideImportance` — this channel only ever touches `cards.leech`.
   */
  'cards.setLeech': {
    input: z.object({ ids: idList, leech: z.boolean() }),
    output: z.object({ updated: z.int().nonnegative() }),
  },

  /**
   * Seeds knowledge items and due review cards for manual QA and the Playwright E2E suite.
   * Same gate as `jobs.enqueueDemo`/`app.devMediaSampleUrl`: refuses outside a dev run or
   * the e2e suite, so nothing in the shipped product can call it.
   */
  'memory.seedReviewDemo': {
    input: z.object({ count: z.int().min(1).max(200) }),
    output: z.object({ itemIds: z.array(z.uuid()), cardIds: z.array(z.uuid()) }),
  },
})
