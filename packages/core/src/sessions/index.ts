/**
 * Runtime activity selection and lesson practice composition — `docs/spec/03-activities.md`
 * §5 and §12 (sub-phase 5.6).
 *
 * `../memory/session.ts` decides *which skills* the learner meets today; this decides *what
 * they are asked* about each one. The two are separate because the scheduler's job ends at
 * the skill: §5's *"a memory item ≠ an activity"*.
 */

export type {
  ActivityOption,
  ActivitySelection,
  HostCapabilities,
  RelaxedRule,
} from './activity-option'
export { V1_CAPABILITIES } from './activity-option'

export type {
  ActivitySelectionHistory,
  ActivitySelectionInput,
  ActivitySelector,
  ActivitySelectorConfig,
} from './activity-selection'
export {
  applySelection,
  createActivitySelector,
  DEFAULT_MAX_MEDIA_PER_SESSION,
  DEFAULT_REPEAT_COOLDOWN_DAYS,
  EMPTY_ACTIVITY_HISTORY,
  historyFromOutcomes,
  selectActivity,
} from './activity-selection'

export type {
  LessonPractice,
  LessonPracticeInput,
  LessonPracticeLimits,
  LessonPracticeRule,
  UnmetRule,
} from './lesson-practice'
export {
  checkLessonPractice,
  composeLessonPractice,
  DEFAULT_LESSON_PRACTICE_LIMITS,
  difficultyOf,
  isMcq,
  MCQ_TYPES,
} from './lesson-practice'

export type {
  GradedAnswer,
  MistakesReviewOptions,
  PresentationPolicy,
  SessionPolicy,
} from './policies'
export {
  composeMistakesReview,
  DEFAULT_MISTAKES_LIMIT,
  policyAllowsType,
  resolvePresentation,
  SESSION_POLICIES,
  WORD_BANK_TYPES,
} from './policies'

export {
  ladderForEntry,
  PROGRESSION_STABILITY,
  stageForEntry,
  stageForStability,
  stageLadder,
} from './progression'
