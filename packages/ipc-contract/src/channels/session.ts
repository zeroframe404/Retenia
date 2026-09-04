import { z } from 'zod'
import { defineContract } from '../define'
import { importanceLevelSchema } from './memory'

/**
 * The daily review session (`docs/spec/02-memory-system.md` §12).
 *
 * The shape of the surface follows the spec's own split. `session.plan` is the "today"
 * screen — counts, minutes, what overload protection would move — and is **read-only**:
 * it writes nothing, so it can be polled and previewed freely. `session.start` is what
 * commits to a plan; it buries siblings and postpones cards, so it carries the same
 * `confirm: z.literal(true)` gate as `memory.rescheduleNow`.
 *
 * Cards are then served **one at a time** through `session.next`. A 2,000-card backlog is a
 * real plan, and shipping 2,000 cards across the bridge to show "35 reviews (~12 min)" would
 * be the most expensive screen in the app for no gain.
 */

/** §12 step 1–5: which step queued the entry. */
export const SESSION_ENTRY_KINDS = ['exam', 'due', 'relearning', 'new', 'reinforcement'] as const
export const sessionEntryKindSchema = z.enum(SESSION_ENTRY_KINDS)

/** §12 step 2: relative overdueness, or Anki 24.11's ascending-R backlog mode. */
export const SESSION_ORDERS = ['relative_overdueness', 'retrievability'] as const
export const sessionOrderSchema = z.enum(SESSION_ORDERS)

/** The four FSRS buttons. `0` (`Manual`) is deliberately absent: it is never an answer
 *  (`.claude/skills/fsrs-rules/SKILL.md`), and a postpone does not come through here. */
export const gradeSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])

/** `ReviewSession.status`, mirroring `REVIEW_SESSION_STATUSES` in core. */
export const REVIEW_SESSION_STATUSES = ['in_progress', 'completed', 'abandoned'] as const
export const reviewSessionStatusSchema = z.enum(REVIEW_SESSION_STATUSES)

/** §7 rule 3's report, as data. The Spanish sentence §12 quotes is rendered by i18n from
 *  these fields — the contract carries no copy. */
export const overloadSummarySchema = z.object({
  plannedCards: z.int().nonnegative(),
  keptCards: z.int().nonnegative(),
  postponedCards: z.int().nonnegative(),
  /** The "hoy hiciste 80 %". */
  completedShare: z.number().min(0).max(1),
  byLevel: z.array(z.object({ level: importanceLevelSchema, count: z.int().nonnegative() })),
  budgetMinutes: z.number().nonnegative(),
  estimatedMinutes: z.number().nonnegative(),
  overloaded: z.boolean(),
  /** Every postponable card was taken and the day is still over budget — §7's urgent
   *  "may exceed the daily limit (catch-up)". */
  stillOverBudget: z.boolean(),
})

export const sessionCountsSchema = z.object({
  exam: z.int().nonnegative(),
  due: z.int().nonnegative(),
  relearning: z.int().nonnegative(),
  new: z.int().nonnegative(),
  reinforcement: z.int().nonnegative(),
  total: z.int().nonnegative(),
})

/** What the "today" screen shows: `"today: 35 reviews (~12 min) + 8 new + reinforcement"`
 *  and the streak goal for bad days (§12, Presentation). */
export const sessionPlanSchema = z.object({
  counts: sessionCountsSchema,
  overload: overloadSummarySchema,
  /** Cards `session.start` would postpone, and siblings it would bury. Counts, not ids:
   *  the preview says how much, the apply decides which. */
  postponements: z.int().nonnegative(),
  burials: z.int().nonnegative(),
  estimatedMinutes: z.number().nonnegative(),
  budgetMinutes: z.number().nonnegative(),
  streakGoalCards: z.int().positive(),
  medianSecondsPerCard: z.number().positive(),
  backlogDays: z.number().nonnegative(),
  newGated: z.boolean(),
  finalDrill: z.boolean(),
  order: sessionOrderSchema,
  seed: z.string(),
  composedAt: z.iso.datetime(),
})
export type SessionPlanDto = z.infer<typeof sessionPlanSchema>

/** The FSRS half of a card, as the review screen needs it. Not the whole row: `payload` is
 *  the activity's, and everything else is audit columns the renderer has no use for. */
export const sessionCardSchema = z.object({
  id: z.uuid(),
  itemId: z.uuid(),
  template: z.string(),
  payload: z.json().nullable(),
  state: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  due: z.iso.datetime(),
  stability: z.number().nonnegative(),
  difficulty: z.number().min(0).max(10),
  scheduledDays: z.int().nonnegative(),
  learningSteps: z.int().nonnegative(),
  reps: z.int().nonnegative(),
  lapses: z.int().nonnegative(),
  lastReview: z.iso.datetime().nullable(),
})

export const reinforcementNodeSchema = z.object({
  id: z.string().min(1),
  lessonId: z.string().nullable(),
  pathId: z.string().nullable(),
  estimatedMinutes: z.number().nonnegative(),
})

export const sessionEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['exam', 'due', 'relearning', 'new']),
    card: sessionCardSchema,
    level: importanceLevelSchema,
    /** §7 rule 6's "today you recall this at ~82 %". */
    retrievability: z.number().min(0).max(1),
    /** The desired retention the policy resolved, so the screen can explain the interval. */
    desiredRetention: z.number().min(0).max(1),
    examId: z.uuid().nullable(),
  }),
  z.object({ kind: z.literal('reinforcement'), node: reinforcementNodeSchema }),
])

export const sessionProgressSchema = z.object({
  sessionId: z.uuid(),
  cursor: z.int().nonnegative(),
  total: z.int().nonnegative(),
  remaining: z.int().nonnegative(),
  reviewed: z.int().nonnegative(),
  again: z.int().nonnegative(),
  hard: z.int().nonnegative(),
  skipped: z.int().nonnegative(),
  /** §12 step 6: cards graded Again/Hard still waiting to come back. */
  drillPending: z.int().nonnegative(),
  drillStarted: z.boolean(),
  finished: z.boolean(),
})

/** §13's streak status. `unknown` until sub-phase 13.1 supplies the history. */
export const streakStatusSchema = z.object({
  state: z.enum(['unknown', 'at_risk', 'kept', 'extended']),
  current: z.int().nonnegative(),
  goalCards: z.int().positive(),
  reviewedToday: z.int().nonnegative(),
  goalMet: z.boolean(),
})

export const sessionSummarySchema = z.object({
  sessionId: z.uuid(),
  reviewed: z.int().nonnegative(),
  again: z.int().nonnegative(),
  hard: z.int().nonnegative(),
  skipped: z.int().nonnegative(),
  /** Correct over graded; `null` when nothing was answered. */
  accuracy: z.number().min(0).max(1).nullable(),
  minutes: z.number().nonnegative(),
  xp: z.int().nonnegative(),
  postponed: z.int().nonnegative(),
  streak: streakStatusSchema,
  overload: overloadSummarySchema,
  finishedAt: z.iso.datetime(),
})

/**
 * Per-session overrides. Every field is optional: `{}` means "the stored settings", which is
 * the normal case. Bounds mirror the `SettingsMap` specs in core, so a value the settings
 * screen would reject cannot get in through a session either.
 */
export const sessionSettingsSchema = z.object({
  budgetMinutes: z.number().min(1).max(1440).optional(),
  streakGoalCards: z.int().min(1).max(9999).optional(),
  newEveryNReviews: z.int().min(3).max(5).optional(),
  order: sessionOrderSchema.optional(),
  finalDrill: z.boolean().optional(),
  dailyNewLimit: z.int().min(0).max(9999).optional(),
})

export const sessionChannels = defineContract({
  /** Compose today without touching anything — the "today" screen. */
  'session.plan': {
    input: sessionSettingsSchema,
    output: sessionPlanSchema,
  },

  /**
   * Start, or resume. Applies the plan's sibling burials and overload postponements, which
   * is why it is confirmed in the schema: an unconfirmed start is rejected at the bridge and
   * never reaches the handler.
   */
  'session.start': {
    input: sessionSettingsSchema.extend({ confirm: z.literal(true) }),
    output: z.object({
      progress: sessionProgressSchema,
      /** `true` when a session left open earlier today was picked up instead of composed. */
      resumed: z.boolean(),
      burials: z.int().nonnegative(),
      postponed: z.int().nonnegative(),
      /** Absent on a resume: the figures shown then are the frozen ones, not a fresh plan. */
      plan: sessionPlanSchema.nullable(),
    }),
  },

  /** The entry the user is on; `null` once the queue — final drill included — is done. */
  'session.next': {
    input: z.void(),
    output: z.object({
      entry: sessionEntrySchema.nullable(),
      progress: sessionProgressSchema,
    }),
  },

  'session.answer': {
    input: z.object({
      rating: gradeSchema,
      /** The grader's 0–1 score when an exercise produced the rating (§10). */
      exerciseScore: z.number().min(0).max(1).nullable().optional(),
      /** Overrides the runner's own timer for a host that measured it more precisely. */
      durationMs: z.int().min(0).max(86_400_000).nullable().optional(),
      attemptId: z.uuid().nullable().optional(),
    }),
    output: z.object({
      card: sessionCardSchema,
      /** Queued for the final drill because it was graded Again or Hard. */
      drilled: z.boolean(),
      progress: sessionProgressSchema,
    }),
  },

  /** Move past the current entry without recording anything. */
  'session.skip': {
    input: z.void(),
    output: z.object({ progress: sessionProgressSchema }),
  },

  /**
   * Undo the last answer: the card is rolled back and its log row soft-deleted — the only
   * mutation the append-only rule permits. `undone: false` when there was nothing to undo.
   */
  'session.undo': {
    input: z.void(),
    output: z.object({
      undone: z.boolean(),
      cardId: z.uuid().nullable(),
      progress: sessionProgressSchema,
    }),
  },

  'session.finish': {
    input: z.void(),
    output: sessionSummarySchema,
  },
})
