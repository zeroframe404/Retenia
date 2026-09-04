import type { Activity } from '../envelope'
import type { InputKind } from '../families/text-input'
import type { ActivityType } from '../registry'
import { type AnswerText, leakIssues } from './common'
import { type Issue, issue } from './types'

/** §11: "answers non-empty" (zod), plus the input kind each text type implies. */

const KINDS: Readonly<Partial<Record<ActivityType, readonly InputKind[]>>> = {
  short_answer: ['text', 'letters'],
  spell_the_word: ['text', 'letters'],
  dictation: ['text', 'letters'],
  numeric_answer: ['number'],
  predict_output: ['text'],
  regex_task: ['regex'],
  expression_input: ['math'],
  typing_drill: ['text'],
}

export function isValidRegex(source: string): boolean {
  try {
    new RegExp(source, 'u')
    return true
  } catch {
    return false
  }
}

export function validateTextInput(activity: Activity<'text_input'>): Issue[] {
  const issues: Issue[] = []
  const { inputKind, answers, numeric, regexCases } = activity.payload

  const allowed = KINDS[activity.type]
  if (allowed !== undefined && !allowed.includes(inputKind)) {
    issues.push(
      issue(
        'text-input-kind-mismatch',
        ['payload', 'inputKind'],
        `"${activity.type}" uses inputKind ${allowed.join(' | ')}, not "${inputKind}"`,
      ),
    )
  }
  if (inputKind === 'number' && numeric === undefined) {
    issues.push(
      issue(
        'numeric-block-required',
        ['payload', 'numeric'],
        'a numeric answer needs payload.numeric with the expected value',
      ),
    )
  }
  if (regexCases !== undefined && inputKind !== 'regex') {
    issues.push(
      issue(
        'regex-cases-misplaced',
        ['payload', 'regexCases'],
        'regexCases only apply to inputKind regex',
      ),
    )
  }

  const plain: AnswerText[] = []
  answers.forEach((answer, index) => {
    if (answer.isRegex) {
      if (!isValidRegex(answer.value)) {
        issues.push(
          issue(
            'regex-invalid',
            ['payload', 'answers', index, 'value'],
            `"${answer.value}" is not a valid regular expression`,
          ),
        )
      }
    } else {
      plain.push({ text: answer.value, path: ['payload', 'answers', index, 'value'] })
    }
  })
  issues.push(...leakIssues(activity, plain))
  return issues
}
