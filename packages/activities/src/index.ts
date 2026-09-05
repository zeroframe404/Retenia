/**
 * `@retenia/activities` — the activity engine's React half (`docs/spec/03-activities.md` §8's
 * `activity-ui/`): `<ActivityHost/>`, the open type registry, one renderer per payload family and
 * the components those renderers share.
 *
 * Importing the package registers the 21 MVP types (see `registry/types/index.ts`), so
 * `getRenderer('mcq_single')` works with no further wiring.
 */
import './registry/types'

export type { AudioButtonProps } from './components/audio-button'
export { AudioButton } from './components/audio-button'
export type { ConfidencePickerProps } from './components/confidence-picker'
export { ConfidencePicker } from './components/confidence-picker'
export type {
  DraggableItemProps,
  DragLayerProps,
  DropZoneProps,
  PlacementContextValue,
} from './components/drag-layer'
export {
  DraggableItem,
  DragLayer,
  DropZone,
  usePlacement,
} from './components/drag-layer'
export type { FeedbackTone } from './components/feedback-panel'
export { FeedbackPanel, feedbackTone } from './components/feedback-panel'
export { HintButton } from './components/hint-button'
export type { ImageStageProps, ImageStageShape } from './components/image-stage'
export { ImageStage } from './components/image-stage'
export type { MathFieldProps } from './components/math-field'
export { MathField } from './components/math-field'
export { RatingChip } from './components/rating-chip'
export type { RichTextProps } from './components/rich-text'
export { RichText, splitMediaTokens } from './components/rich-text'
export type { RubricBreakdownProps } from './components/rubric-breakdown'
export { RubricBreakdown } from './components/rubric-breakdown'
export type { BankToken, TokenBankProps } from './components/token-bank'
export { TokenBank } from './components/token-bank'
export type {
  ActivityEvent,
  ActivityEventContext,
  ActivityEventHandler,
  ActivityEventName,
  ActivityEventObject,
  ActivityEventResult,
  ActivityVerb,
} from './events'
export { ACTIVITY_VERBS, activityEvent, isoDuration } from './events'
export type {
  ActivityContextValue,
  ExplanationState,
  ExplanationStatus,
  FamilyActivityContext,
} from './host/activity-context'
export { ActivityProvider, useActivity, useFamilyActivity } from './host/activity-context'
export type { ActivityHostProps } from './host/activity-host'
export { ActivityHost } from './host/activity-host'
export { emptyResponse, hasEmptyResponse } from './host/empty-response'
export type {
  ExplainAnswerInput,
  ExplainAnswerPort,
  GradePort,
  NowPort,
  SpeakInput,
  SpeakPort,
} from './host/ports'
export {
  answerTextOf,
  ExplainAnswerUnavailableError,
  explainAnswerPort,
  noopSpeak,
  staticExplainAnswer,
} from './host/ports'
export { createRng, hashSeed, listSeed, shuffleWithRng, shuffleWithSeed } from './host/shuffle'
export type { ActivityCompletion, UseActivityMachineOptions } from './host/use-activity-machine'
export {
  applyHintPenalty,
  createAiGradePort,
  DEFAULT_MAX_ATTEMPTS,
  defaultGrade,
  isAiGraded,
  TIMER_INTERVAL_MS,
  useActivityMachine,
} from './host/use-activity-machine'
export type { ActivityLabels } from './labels'
export { DEFAULT_ACTIVITY_LABELS, formatLabel, resolveLabels } from './labels'
export {
  canHint,
  canOverrideRating,
  canRetry,
  canSubmit,
  createActivityReducer,
  initialActivityState,
  isLocked,
} from './machine/reducer'
export type {
  ActivityAction,
  ActivityMachineConfig,
  ActivityMachineState,
  ActivityMode,
  ActivityOutcome,
  ActivityStatus,
} from './machine/types'
export {
  ACTIVITY_MODES,
  ACTIVITY_STATUSES,
  allowsHints,
  defersFeedback,
} from './machine/types'
export type { PromptStubInput } from './registry/prompt-stub'
export { promptStub, SHARED_GENERATION_RULES } from './registry/prompt-stub'
export type {
  ActivityCapabilities,
  ActivityGenerationSpec,
  ActivityGrader,
  ActivityReviewSpec,
  ActivityTypeDefinition,
  ActivityTypeEntry,
  ProgressionStage,
  SourceMode,
} from './registry/registry'
export {
  ActivityTypeError,
  defineActivityType,
  findActivityType,
  getActivityType,
  getRenderer,
  isActivityTypeRegistered,
  PROGRESSION_STAGES,
  registerActivityType,
  registeredActivityTypes,
  resetActivityTypeRegistry,
  SOURCE_MODES,
} from './registry/registry'
export type { ActivityRendererComponent } from './registry/renderers'
export { familyRenderer, hasRenderer, preloadFamily } from './registry/renderers'
