/**
 * The domain vocabulary: every closed set of values an entity field can take.
 *
 * These mirror the `CHECK (… IN (…))` constraints of `docs/spec/07a-schema.md` one for one.
 * The SQLite adapter keeps its own copies (they build the SQL constraints); a parity test in
 * `packages/db` fails if the two ever drift.
 */

/** `docs/spec/02-memory-system.md` §7. `paused` is out of the queue entirely. */
export const IMPORTANCE_LEVELS = ['urgent', 'high', 'normal', 'maintenance', 'paused'] as const
export type ImportanceLevel = (typeof IMPORTANCE_LEVELS)[number]

export const LEECH_ACTIONS = ['warn', 'warn_rewrite', 'edit', 'suspend', 'none'] as const
export type LeechAction = (typeof LEECH_ACTIONS)[number]

// --- source library -------------------------------------------------------------------

export const SOURCE_KINDS = [
  'pdf',
  'docx',
  'epub',
  'pptx',
  'markdown',
  'text',
  'image',
  'audio',
  'video',
  'youtube',
  'web',
] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

export const SOURCE_STATUSES = ['pending', 'processing', 'ready', 'failed'] as const
export type SourceStatus = (typeof SOURCE_STATUSES)[number]

/**
 * Where a source stands in the *vector* index — a different question from whether it parsed.
 * A source can be `ready` and fully searchable by BM25 while its embeddings are missing,
 * queued behind a model download, or in the space of a model the user has switched away
 * from (`docs/spec/05-ingestion-rag.md` §3).
 */
export const EMBEDDING_STATUSES = ['pending', 'running', 'ready', 'failed'] as const
export type EmbeddingStatus = (typeof EMBEDDING_STATUSES)[number]

export const SOURCE_UNIT_KINDS = ['page', 'slide', 'section', 'keyframe', 'segment'] as const
export type SourceUnitKind = (typeof SOURCE_UNIT_KINDS)[number]

export const ANNOTATION_KINDS = ['highlight', 'note', 'region', 'clip'] as const
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number]

// --- learning paths -------------------------------------------------------------------

export const PATH_STATUSES = ['draft', 'generating', 'active', 'completed', 'archived'] as const
export type PathStatus = (typeof PATH_STATUSES)[number]

export const LESSON_KINDS = ['core', 'remediation', 'reinforcement', 'checkpoint'] as const
export type LessonKind = (typeof LESSON_KINDS)[number]

export const LESSON_STATUSES = ['pending', 'generating', 'qa', 'ready', 'failed'] as const
export type LessonStatus = (typeof LESSON_STATUSES)[number]

export const BLOOM_LEVELS = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
] as const
export type BloomLevel = (typeof BLOOM_LEVELS)[number]

/** The 22 payload families of `docs/spec/03-activities.md` §7, plus `simulation`. */
export const ACTIVITY_FAMILIES = [
  'choice',
  'text_input',
  'cloze',
  'long_text',
  'pairs',
  'ordering',
  'categorize',
  'image_target',
  'text_mark',
  'scale',
  'speech',
  'dialogue',
  'branching',
  'media_checkpoints',
  'code',
  'math',
  'graph',
  'grid_game',
  'arcade',
  'cards',
  'disclosure',
  'draw',
  'simulation',
] as const
export type ActivityFamily = (typeof ACTIVITY_FAMILIES)[number]

export const ACTIVITY_STATUSES = ['ready', 'pending_media', 'needs_review', 'rejected'] as const
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number]

/**
 * Where a "Generate with AI" run stands (`docs/spec/04-path-generation.md` §3, sub-phase
 * 8.1). The status is the stage. `blocked_budget` is a pause, not an end — the run's own
 * cost cap (or the monthly one) stopped it before the next paid call — and it resumes on
 * "continue anyway". Terminal: `completed`, `failed`, `cancelled`. *
 * `expanding` is stage 7 (sub-phase 8.3) and runs as a row of its own: the draft's run
 * finishes at `persisting`, and the user freezes the path — and starts the expansion —
 * later, possibly days later.
 */
export const GENERATION_RUN_STATUSES = [
  'queued',
  'extracting',
  'consolidating',
  'synthesizing',
  'sequencing',
  'persisting',
  'expanding',
  'completed',
  'failed',
  'cancelled',
  'blocked_budget',
] as const
export type GenerationRunStatus = (typeof GENERATION_RUN_STATUSES)[number]

/**
 * How much help an activity type gives the learner — `docs/spec/03-activities.md` §5's
 * "progression per skill": *"1st exposure → recognition (`mcq` / `true_false` /
 * `cloze_dropdown`); medium stability → assisted production (`cloze_wordbank`,
 * `sentence_builder`, `matching`); high stability → free production (`cloze_typed`,
 * `short_answer`, `free_recall`)"*.
 *
 * It lives in `core` rather than in the activity registry because the session generator —
 * which is the thing that reads it — is domain logic, and `core` may import no internal
 * package (`tooling/scripts/check-deps.mjs`). `packages/activities` imports it from here so
 * there is one list, not two that drift.
 *
 * `theory` is the odd one out: it is not a rung of the ladder but the marker for the
 * lesson-only types (`disclosure_block`), which are never selected for review.
 */
export const PROGRESSION_STAGES = ['theory', 'recognition', 'assisted', 'production'] as const
export type ProgressionStage = (typeof PROGRESSION_STAGES)[number]

/** How an activity is being served — `docs/spec/03-activities.md` §12's study/test split
 *  and §5's "Legendary" policy. Mirrors the `ActivityHost` machine's own modes. */
export const ATTEMPT_MODES = ['study', 'test', 'review'] as const
export type AttemptMode = (typeof ATTEMPT_MODES)[number]

// --- exams and item bank --------------------------------------------------------------

export const EXAM_KINDS = ['dated', 'mock', 'final', 'diagnostic'] as const
export type ExamKind = (typeof EXAM_KINDS)[number]

export const EXAM_STATUSES = ['planned', 'active', 'completed', 'archived'] as const
export type ExamStatus = (typeof EXAM_STATUSES)[number]

export const EXAM_FORMS = ['A', 'B'] as const
export type ExamForm = (typeof EXAM_FORMS)[number]

export const EXAM_ATTEMPT_MODES = ['real', 'blind', 'preview'] as const
export type ExamAttemptMode = (typeof EXAM_ATTEMPT_MODES)[number]

export const ITEM_USAGES = [
  'diagnostic',
  'reinforcement',
  'final_exam_A',
  'final_exam_B',
  'remediation',
  'mock',
] as const
export type ItemUsage = (typeof ITEM_USAGES)[number]

// --- remediation ----------------------------------------------------------------------

/**
 * What fired a remediation (`docs/spec/04-path-generation.md` §11 "Triggers"): the module
 * reinforcement under 70 % on a concept; ≥ 2 lapses in 14 days (`memory_lapses`) or a mean
 * R under 0.7 (`memory_retention`) on the concept's cards — two values so each threshold can
 * be tuned on its own; a confident error in the diagnostic or an exam; the same
 * `misconception_id` failed twice; the learner's "no lo entiendo".
 */
export const REMEDIATION_TRIGGERS = [
  'reinforcement_low',
  'memory_lapses',
  'memory_retention',
  'confident_error',
  'repeated_misconception',
  'user_request',
] as const
export type RemediationTrigger = (typeof REMEDIATION_TRIGGERS)[number]

/**
 * A remediation's lifecycle. `active` is a detour on the path map; `completed` and
 * `dismissed` are the learner's two ways out of it; `refused` is a trigger the §11 limits
 * turned down, kept so the thresholds can be tuned against what was *not* inserted; `failed`
 * is a detour P11 could not write.
 */
export const REMEDIATION_STATUSES = [
  'active',
  'completed',
  'dismissed',
  'refused',
  'failed',
] as const
export type RemediationStatus = (typeof REMEDIATION_STATUSES)[number]

/** Why the §11 limits refused a trigger. `revisit_core` is the third remediation of one
 *  concept: the learner is sent back to the core lesson instead. */
export const REMEDIATION_REFUSALS = [
  'duplicate_concept',
  'module_active',
  'weekly_limit',
  'revisit_core',
  'no_anchor',
] as const
export type RemediationRefusal = (typeof REMEDIATION_REFUSALS)[number]

// --- prior-knowledge diagnostic -------------------------------------------------------

/** A diagnostic session's lifecycle (`docs/spec/04-path-generation.md` §10, sub-phase 8.5).
 *  There is no `abandoned` status: walking away is one of `DIAGNOSTIC_STOP_REASONS`. */
export const DIAGNOSTIC_SESSION_STATUSES = ['in_progress', 'completed'] as const
export type DiagnosticSessionStatus = (typeof DIAGNOSTIC_SESSION_STATUSES)[number]

/** How the user came in: "desde cero" (`scratch`), "ya sé parte" (`partial`), or the path
 *  preview's "ya lo sé" (`preview`) — the last recorded as an already-completed session, so
 *  what it marked can be undone the same way as a diagnostic's result. */
export const DIAGNOSTIC_ENTRIES = ['scratch', 'partial', 'preview'] as const
export type DiagnosticEntry = (typeof DIAGNOSTIC_ENTRIES)[number]

/** Why a diagnostic stopped: §10 step 7's limits, plus `from_scratch` (nothing was ever going
 *  to be asked) and `no_items` (the bank had nothing left that would not repeat a concept). */
export const DIAGNOSTIC_STOP_REASONS = [
  'from_scratch',
  'all_classified',
  'no_items',
  'max_items',
  'time_limit',
  'abandoned',
] as const
export type DiagnosticStopReason = (typeof DIAGNOSTIC_STOP_REASONS)[number]

// --- memory ---------------------------------------------------------------------------

/** `ts-fsrs` `State`: 0 New, 1 Learning, 2 Review, 3 Relearning. */
export const CARD_STATES = [0, 1, 2, 3] as const
export type CardState = (typeof CARD_STATES)[number]

/** `ts-fsrs` `Rating`: 0 Manual, 1 Again, 2 Hard, 3 Good, 4 Easy. */
export const RATINGS = [0, 1, 2, 3, 4] as const
export type Rating = (typeof RATINGS)[number]

export const KNOWLEDGE_ITEM_KINDS = [
  'fact',
  'concept',
  'procedure',
  'principle',
  'example',
  'misconception',
  'vocabulary',
  'other',
] as const
export type KnowledgeItemKind = (typeof KNOWLEDGE_ITEM_KINDS)[number]

export const KNOWLEDGE_ITEM_STATUSES = ['need_to_learn', 'active', 'archived'] as const
export type KnowledgeItemStatus = (typeof KNOWLEDGE_ITEM_STATUSES)[number]

export const CREATED_BY = ['user', 'ai', 'import'] as const
export type CreatedBy = (typeof CREATED_BY)[number]

// --- sessions, attempts, review log ---------------------------------------------------

export const LESSON_SESSION_STATUSES = ['in_progress', 'completed', 'abandoned'] as const
export type LessonSessionStatus = (typeof LESSON_SESSION_STATUSES)[number]

/** A daily review session's lifecycle. The same three words as a lesson session, because a
 *  session is a session: it is open, it was finished, or it was walked away from. */
export const REVIEW_SESSION_STATUSES = ['in_progress', 'completed', 'abandoned'] as const
export type ReviewSessionStatus = (typeof REVIEW_SESSION_STATUSES)[number]

export const ATTEMPT_CONTEXTS = [
  'lesson',
  'review',
  'reinforcement',
  'exam',
  'diagnostic',
  'remediation',
] as const
export type AttemptContext = (typeof ATTEMPT_CONTEXTS)[number]

export const CONFIDENCE_LEVELS = ['sure', 'unsure', 'guessed'] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

export const REVIEW_CONTEXTS = [
  'daily',
  'lesson',
  'reinforcement',
  'exam_sim',
  'cram',
  'manual_postpone',
  /** The prior-knowledge diagnostic of `docs/spec/04-path-generation.md` — sub-phase 8.5
   *  seeds the memory of the modules it proves you already know. */
  'diagnostic',
  'import',
] as const
export type ReviewContext = (typeof REVIEW_CONTEXTS)[number]

// --- infrastructure -------------------------------------------------------------------

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export const AI_CALL_STATUSES = ['ok', 'error'] as const
export type AiCallStatus = (typeof AI_CALL_STATUSES)[number]

/**
 * Where a submitted Batch API job stands (`docs/spec/06-ai-providers.md` §2).
 *
 * `submitting` is the window between writing the row and the provider confirming it: the row
 * is written first on purpose, so a crash cannot leave a job running upstream that this app
 * has no record of. Recovery retires anything still in it, because there is no id to poll and
 * no way to know whether the provider accepted the work.
 */
export const AI_BATCH_STATUSES = [
  'submitting',
  'submitted',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
] as const
export type AiBatchStatus = (typeof AI_BATCH_STATUSES)[number]

export const OUTBOX_OPS = ['insert', 'update', 'delete'] as const
export type OutboxOp = (typeof OUTBOX_OPS)[number]

// --- gamification ---------------------------------------------------------------------

export const XP_REASONS = [
  'lesson',
  'review',
  'reinforcement',
  'mock_exam',
  'quest',
  'achievement',
  'bonus',
] as const
export type XpReason = (typeof XP_REASONS)[number]
