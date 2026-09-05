import type { ConfidenceLevel, Grade } from '@retenia/core'

/**
 * Every string the host and the shared components render, as a prop with an English default —
 * the same contract `@retenia/ui` uses (`CodeBlock`'s `copyLabel`, `Countdown`'s units).
 *
 * `packages/activities` deliberately does **not** call `useTranslation`: `docs/spec/00-conventions.md`
 * puts UI strings in i18n resources, and the i18n instance lives in the app, not in a library that
 * Storybook and the renderer both mount. The app passes its `es-AR` strings through `labels`, so
 * "Explicame" is what a user sees while the package keeps zero i18n coupling.
 *
 * Placeholders are `{name}` and are filled by `formatLabel`.
 */
export interface ActivityLabels {
  check: string
  retry: string
  continue: string
  skip: string
  /** `{used}` / `{total}`. */
  hint: string
  hintHeading: string
  dismissHint: string
  /** §9's "Explain" button — `Explicame` in `es-AR`. */
  explain: string
  explainLoading: string
  explainError: string
  explanationHeading: string
  grading: string
  gradeFailed: string
  correct: string
  incorrect: string
  partiallyCorrect: string
  modelAnswer: string
  feedbackHeading: string
  /** `{score}` as a percentage. */
  scoreLabel: string
  elapsed: string
  attemptsLabel: string
  timeUp: string
  deferredFeedback: string
  confidenceHeading: string
  confidence: Record<ConfidenceLevel, string>
  selfGradeHeading: string
  selfGrade: Record<Grade, string>
  /** `dialog_cards`' two-button self rating (§4 row 3: "I knew it / no"). */
  selfRatingKnew: string
  selfRatingForgot: string
  revealAnswer: string
  front: string
  back: string
  /** The near-miss diff under a `text_input` answer: "Your answer" vs. `modelAnswer`. */
  yourAnswer: string
  /** Keyboard alternative to drag-and-drop (§9: "a keyboard alternative for every drag-and-drop"). */
  dragKeyboardHint: string
  pickUp: string
  drop: string
  removePlacement: string
  moveUp: string
  moveDown: string
  unplacedHeading: string
  /** `{n}`: the accessible name of a cloze gap. */
  gapLabel: string
  playAudio: string
  audioUnavailable: string
  loadingRenderer: string
  unsupportedType: string
}

export const DEFAULT_ACTIVITY_LABELS: ActivityLabels = Object.freeze({
  check: 'Check',
  retry: 'Try again',
  continue: 'Continue',
  skip: 'Skip',
  hint: 'Hint ({used}/{total})',
  hintHeading: 'Hint',
  dismissHint: 'Hide hint',
  explain: 'Explain my answer',
  explainLoading: 'Thinking…',
  explainError: 'The explanation could not be generated.',
  explanationHeading: 'Explanation',
  grading: 'Checking…',
  gradeFailed: 'The answer could not be graded. Try again.',
  correct: 'Correct',
  incorrect: 'Incorrect',
  partiallyCorrect: 'Partly correct',
  modelAnswer: 'Model answer',
  feedbackHeading: 'Feedback',
  scoreLabel: '{score}%',
  elapsed: 'Time',
  attemptsLabel: 'Attempt {attempt}',
  timeUp: 'Time is up.',
  deferredFeedback: 'Your answers are shown at the end of the exam.',
  confidenceHeading: 'How sure are you?',
  confidence: { sure: 'Sure', unsure: 'Not sure', guessed: 'Guessed' },
  selfGradeHeading: 'How well did you remember it?',
  selfGrade: { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' },
  selfRatingKnew: 'I knew it',
  selfRatingForgot: 'No',
  revealAnswer: 'Show the answer',
  front: 'Front',
  back: 'Back',
  yourAnswer: 'Your answer',
  dragKeyboardHint:
    'Drag, or press Enter to pick up, the arrow keys to choose a place and Enter to drop it.',
  pickUp: 'Pick up',
  drop: 'Place here',
  removePlacement: 'Remove',
  moveUp: 'Move up',
  moveDown: 'Move down',
  unplacedHeading: 'Available',
  gapLabel: 'Gap {n}',
  playAudio: 'Play audio',
  audioUnavailable: 'Audio is not available yet.',
  loadingRenderer: 'Loading the activity…',
  unsupportedType: 'This activity type has no renderer yet.',
})

export function resolveLabels(overrides?: Partial<ActivityLabels>): ActivityLabels {
  if (!overrides) return DEFAULT_ACTIVITY_LABELS
  return {
    ...DEFAULT_ACTIVITY_LABELS,
    ...overrides,
    confidence: { ...DEFAULT_ACTIVITY_LABELS.confidence, ...overrides.confidence },
    selfGrade: { ...DEFAULT_ACTIVITY_LABELS.selfGrade, ...overrides.selfGrade },
  }
}

/** Fills `{name}` placeholders; an unknown name is left as-is so a typo is visible, not silent. */
export function formatLabel(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  )
}
