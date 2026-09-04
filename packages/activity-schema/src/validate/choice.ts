import type { Activity } from '../envelope'
import type { ActivityType } from '../registry'
import { type AnswerText, leakIssues } from './common'
import { type Issue, issue } from './types'

/** §11: "exactly 1 correct answer in `mcq_single`", and the shape each choice type implies. */

/** Types that are one question: exactly one set. */
const ONE_SET: ReadonlySet<ActivityType> = new Set([
  'mcq_single',
  'mcq_multi',
  'true_false',
  'complete_the_chat',
])
/** Types that are a burst of questions: at least two sets. */
const MANY_SETS: ReadonlySet<ActivityType> = new Set(['statement_set', 'single_choice_set'])
/** Types whose options are the labels "true" / "false": the labels are not an answer that can leak. */
const LABEL_OPTIONS: ReadonlySet<ActivityType> = new Set(['true_false', 'statement_set'])
const MULTIPLE_FLAG: Readonly<Partial<Record<ActivityType, boolean>>> = {
  mcq_single: false,
  mcq_multi: true,
  true_false: false,
  statement_set: false,
  single_choice_set: false,
  complete_the_chat: false,
}

export function validateChoice(activity: Activity<'choice'>): Issue[] {
  const issues: Issue[] = []
  const { sets } = activity.payload
  const { type } = activity

  if (ONE_SET.has(type) && sets.length !== 1) {
    issues.push(
      issue(
        'choice-set-count',
        ['payload', 'sets'],
        `"${type}" has exactly one set, got ${sets.length}`,
      ),
    )
  }
  if (MANY_SETS.has(type) && sets.length < 2) {
    issues.push(
      issue(
        'choice-set-count',
        ['payload', 'sets'],
        `"${type}" has at least two sets, got ${sets.length}`,
      ),
    )
  }
  if (type === 'confidence_mcq' && activity.payload.askConfidence !== true) {
    issues.push(
      issue(
        'choice-confidence-required',
        ['payload', 'askConfidence'],
        'confidence_mcq asks for certainty',
      ),
    )
  }

  const answers: AnswerText[] = []
  const stems: AnswerText[] = []
  sets.forEach((set, s) => {
    const path = ['payload', 'sets', s]
    const expectedFlag = MULTIPLE_FLAG[type]
    if (expectedFlag !== undefined && set.multiple !== expectedFlag) {
      issues.push(
        issue(
          'choice-multiple-flag',
          [...path, 'multiple'],
          `"${type}" sets are multiple: ${expectedFlag}`,
        ),
      )
    }
    const correct = set.options.filter((option) => option.correct)
    if (!set.multiple && correct.length !== 1) {
      issues.push(
        issue(
          'choice-single-correct-count',
          [...path, 'options'],
          `a single-choice set has exactly one correct option, got ${correct.length}`,
        ),
      )
    }
    if (set.multiple && correct.length === 0) {
      issues.push(
        issue(
          'choice-multi-correct-count',
          [...path, 'options'],
          'a multiple-response set has at least one correct option',
        ),
      )
    }
    if (correct.length === set.options.length) {
      issues.push(
        issue(
          'choice-all-correct',
          [...path, 'options'],
          'every option is correct: nothing to choose',
        ),
      )
    }
    if (type === 'true_false' && set.options.length !== 2) {
      issues.push(
        issue(
          'choice-option-count',
          [...path, 'options'],
          `true_false has two options, got ${set.options.length}`,
        ),
      )
    }
    const { minSelect, maxSelect } = set
    if (
      !set.multiple &&
      ((minSelect !== undefined && minSelect !== 1) || (maxSelect !== undefined && maxSelect !== 1))
    ) {
      issues.push(
        issue('choice-select-range', [...path], 'a single-choice set selects exactly one option'),
      )
    } else if (
      (maxSelect !== undefined && maxSelect > set.options.length) ||
      (minSelect !== undefined && maxSelect !== undefined && minSelect > maxSelect)
    ) {
      issues.push(
        issue('choice-select-range', [...path], 'minSelect ≤ maxSelect ≤ number of options'),
      )
    }
    if (set.stem !== undefined) stems.push({ text: set.stem, path: [...path, 'stem'] })
    set.options.forEach((option, o) => {
      if (option.correct) answers.push({ text: option.text, path: [...path, 'options', o, 'text'] })
    })
  })

  if (!LABEL_OPTIONS.has(type)) issues.push(...leakIssues(activity, answers, stems))
  return issues
}
