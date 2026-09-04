import type { Activity, GradeResult } from '@retenia/activity-schema'
import { GraderUnsupportedError } from './errors'
import { gradeCards } from './families/cards'
import { gradeCategorize } from './families/categorize'
import { gradeChoice } from './families/choice'
import { gradeCloze } from './families/cloze'
import { gradeDisclosure } from './families/disclosure'
import { gradeLongText } from './families/long-text'
import { gradeOrdering } from './families/ordering'
import { gradePairs } from './families/pairs'
import type { AttemptMeta } from './families/shared'
import { gradeTextInput } from './families/text-input'
import { gradeTextMark } from './families/text-mark'

/**
 * One entry point per activity: dispatches on `family` (`docs/spec/03-activities.md` §7:
 * the family "decides grader and validation"). The response is validated by the family's
 * response schema inside each grader; a malformed one throws a `ZodError`.
 */
export function gradeActivity(
  activity: Activity,
  response: unknown,
  meta: AttemptMeta,
): GradeResult {
  switch (activity.family) {
    case 'choice':
      return gradeChoice(activity, response, meta)
    case 'text_input':
      return gradeTextInput(activity, response, meta)
    case 'cloze':
      return gradeCloze(activity, response, meta)
    case 'long_text':
      return gradeLongText(activity, response, meta)
    case 'pairs':
      return gradePairs(activity, response, meta)
    case 'ordering':
      return gradeOrdering(activity, response, meta)
    case 'categorize':
      return gradeCategorize(activity, response, meta)
    case 'text_mark':
      return gradeTextMark(activity, response, meta)
    case 'cards':
      return gradeCards(activity, response, meta)
    case 'disclosure':
      return gradeDisclosure(activity, response, meta)
    default:
      throw new GraderUnsupportedError(`family "${activity.family}"`)
  }
}
