export type IssueSeverity = 'error' | 'warning'
export type IssuePath = (string | number)[]

export const ISSUE_CODES = [
  // schema layer (checkActivity only)
  'schema',
  // every family
  'duplicate-id',
  'media-ref-unknown',
  'media-unresolvable',
  'source-span-inverted',
  'review-mismatch',
  'grading-method-mismatch',
  'skills-required',
  'answer-in-prompt',
  'hint-reveals-answer',
  // choice
  'choice-set-count',
  'choice-multiple-flag',
  'choice-single-correct-count',
  'choice-multi-correct-count',
  'choice-all-correct',
  'choice-option-count',
  'choice-select-range',
  'choice-confidence-required',
  // text_input
  'text-input-kind-mismatch',
  'numeric-block-required',
  'regex-invalid',
  'regex-cases-misplaced',
  // cloze
  'cloze-no-gaps',
  'cloze-mode-mismatch',
  'cloze-gap-options-required',
  'cloze-gap-answer-not-in-options',
  'cloze-distractor-is-answer',
  'cloze-adjacent-gaps',
  'cloze-gap-answer-leak',
  // long_text
  'word-range-inverted',
  'key-points-required',
  'rubric-required',
  'model-answer-required',
  'rubric-level-scores-duplicate',
  // pairs
  'pairs-left-duplicate',
  'pairs-right-duplicate',
  'pairs-distractor-is-answer',
  'pairs-presentation-mismatch',
  'pairs-time-limit-required',
  // ordering
  'order-not-permutation',
  'alt-order-not-permutation',
  'alt-order-equals-correct',
  'ordering-scoring-mismatch',
  'ordering-indent-missing',
  'ordering-distractor-is-item',
  // categorize
  'category-unknown',
  'category-unused',
  'categorize-item-all-categories',
  // text_mark
  'token-unknown',
  'text-mark-correct-duplicate',
  'text-mark-all-correct',
  // cards
  'card-count',
  'card-sides-equal',
  // image_target (placeholder, checked defensively)
  'shape-unknown',
] as const
export type IssueCode = (typeof ISSUE_CODES)[number]

/** One finding of the rules layer (`docs/spec/03-activities.md` §11, layer 2). */
export interface Issue {
  code: IssueCode
  path: IssuePath
  message: string
  severity: IssueSeverity
}

export function issue(
  code: IssueCode,
  path: IssuePath,
  message: string,
  severity: IssueSeverity = 'error',
): Issue {
  return { code, path, message, severity }
}
