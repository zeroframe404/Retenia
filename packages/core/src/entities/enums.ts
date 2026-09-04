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

export const SOURCE_UNIT_KINDS = ['page', 'slide', 'section', 'keyframe', 'segment'] as const
export type SourceUnitKind = (typeof SOURCE_UNIT_KINDS)[number]

export const ANNOTATION_KINDS = ['highlight', 'note', 'region', 'clip'] as const
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number]

// --- learning paths -------------------------------------------------------------------

export const PATH_STATUSES = ['draft', 'generating', 'active', 'completed', 'archived'] as const
export type PathStatus = (typeof PATH_STATUSES)[number]

export const LESSON_KINDS = ['core', 'remediation', 'reinforcement', 'checkpoint'] as const
export type LessonKind = (typeof LESSON_KINDS)[number]

export const LESSON_STATUSES = ['pending', 'generating', 'ready', 'failed'] as const
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
  'import',
] as const
export type ReviewContext = (typeof REVIEW_CONTEXTS)[number]

// --- infrastructure -------------------------------------------------------------------

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export const AI_CALL_STATUSES = ['ok', 'error'] as const
export type AiCallStatus = (typeof AI_CALL_STATUSES)[number]

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
