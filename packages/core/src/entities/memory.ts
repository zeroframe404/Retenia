import type { Entity, JsonObject, JsonValue } from './_common'
import type {
  CardState,
  CreatedBy,
  ImportanceLevel,
  KnowledgeItemKind,
  KnowledgeItemStatus,
  LeechAction,
} from './enums'

/** Importance levels, FSRS parameters, knowledge items and cards.
 *  The FSRS fields mirror `ts-fsrs` 1:1 — never rename or reshape them (CLAUDE.md). */

/** One of the five importance levels and the scheduling budget it buys
 *  (`docs/spec/02-memory-system.md` §7). Seeded by migration `0001`. */
export interface ImportanceLevelConfig extends Entity {
  name: ImportanceLevel
  /** null for `paused`: the level is out of the queue. */
  desiredRetention: number | null
  maxIntervalDays: number | null
  orderRank: number
  postponeAllowed: boolean
  /** null = no per-level cap on new items per day. */
  newPerDay: number | null
  leechThreshold: number
  leechAction: LeechAction
}

/** A set of FSRS parameters, per scope (global today, per-domain once there are enough
 *  reviews to optimize one). */
export interface SchedulerProfile extends Entity {
  scope: string
  algorithm: string
  /** `w0…w20` — the 21 optimizable FSRS-6 parameters. */
  w: number[]
  decay: number | null
  learningSteps: string[]
  relearningSteps: string[]
  enableFuzz: boolean
  enableShortTerm: boolean
  maximumInterval: number
  dayStartHour: number
  trainedAt: Date | null
  nReviews: number | null
  logLoss: number | null
  rmse: number | null
}

/** One thing worth remembering — roughly Anki's "note". Cards are its renderings. */
export interface KnowledgeItem extends Entity {
  lessonId: string | null
  topicId: string | null
  kind: KnowledgeItemKind
  fields: JsonObject
  sourceId: string | null
  annotationId: string | null
  locator: JsonObject | null
  /** ISO date the claim was true as of (Wozniak's rule 19). */
  asOf: string | null
  importance: ImportanceLevel
  status: KnowledgeItemStatus
  createdBy: CreatedBy
  tags: JsonValue[]
}

/**
 * A scheduled rendering of a knowledge item. `due`…`lastReview` are `ts-fsrs`'s `Card`
 * verbatim; everything after them is Retenia's own. `elapsedDays` is deliberately absent
 * (ts-fsrs@6 drops it and derives it from `lastReview`).
 */
export interface Card extends Entity {
  itemId: string
  /** `basic`, `reverse`, `cloze:c1`, `occlusion:3`, an activity type id… */
  template: string
  payload: JsonObject | null

  // --- ts-fsrs Card, 1:1 ---
  due: Date
  stability: number
  difficulty: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  state: CardState
  lastReview: Date | null

  // --- Retenia additions ---
  suspended: boolean
  buriedUntil: Date | null
  leech: boolean
  /** Beats the item's importance when set (`docs/spec/02-memory-system.md` §7 rule 1). */
  importanceOverride: ImportanceLevel | null
  /**
   * When the override stops applying. `null` is a permanent override the user set by hand;
   * a date makes it **urgent mode** — the temporary 48–72 h DR 0.97 push of §7 rule 5. Once
   * it has passed the override is ignored on read and swept away by `expireUrgentMode`.
   */
  importanceOverrideExpiresAt: Date | null
  examId: string | null
}
