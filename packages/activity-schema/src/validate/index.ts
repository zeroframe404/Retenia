import { type Activity, activitySchema } from '../envelope'
import { validateCards } from './cards'
import { validateCategorize } from './categorize'
import { validateChoice } from './choice'
import { validateCloze } from './cloze'
import { commonIssues } from './common'
import { validateDisclosure } from './disclosure'
import { validateImageTarget } from './image-target'
import { validateLongText } from './long-text'
import { validateOrdering } from './ordering'
import { validatePairs } from './pairs'
import { validateTextInput } from './text-input'
import { validateTextMark } from './text-mark'
import type { Issue } from './types'

export * from './common'
export { isValidRegex } from './text-input'
export * from './types'

/**
 * Layer 2 of `docs/spec/03-activities.md` §11: the per-type rules zod cannot express. Takes a
 * parsed activity; `checkActivity` runs both layers on raw JSON.
 *
 * An `error` makes the activity unusable (a session must not serve it); a `warning` is a QA
 * finding for the generation pipeline's critic (§11's repair loop) that a human may accept.
 */
export function validateActivity(activity: Activity): Issue[] {
  const issues = commonIssues(activity)
  switch (activity.family) {
    case 'choice':
      issues.push(...validateChoice(activity))
      break
    case 'text_input':
      issues.push(...validateTextInput(activity))
      break
    case 'cloze':
      issues.push(...validateCloze(activity))
      break
    case 'long_text':
      issues.push(...validateLongText(activity))
      break
    case 'pairs':
      issues.push(...validatePairs(activity))
      break
    case 'ordering':
      issues.push(...validateOrdering(activity))
      break
    case 'categorize':
      issues.push(...validateCategorize(activity))
      break
    case 'text_mark':
      issues.push(...validateTextMark(activity))
      break
    case 'cards':
      issues.push(...validateCards(activity))
      break
    case 'disclosure':
      issues.push(...validateDisclosure(activity))
      break
    case 'image_target':
      issues.push(...validateImageTarget(activity))
      break
    default:
      // The other placeholder families have no rules yet; the shared ones still ran.
      break
  }
  return issues
}

export type CheckResult =
  | { ok: true; activity: Activity; warnings: Issue[] }
  | { ok: false; layer: 'schema'; issues: Issue[] }
  | { ok: false; layer: 'rules'; activity: Activity; issues: Issue[] }

/** Both validation layers over raw JSON: zod first, then the rules. `ok` means no `error`. */
export function checkActivity(json: unknown): CheckResult {
  const parsed = activitySchema.safeParse(json)
  if (!parsed.success) {
    return {
      ok: false,
      layer: 'schema',
      issues: parsed.error.issues.map((zodIssue) => ({
        code: 'schema',
        path: zodIssue.path.map((segment) =>
          typeof segment === 'symbol' ? String(segment) : segment,
        ),
        message: zodIssue.message,
        severity: 'error',
      })),
    }
  }
  const issues = validateActivity(parsed.data)
  if (issues.some((found) => found.severity === 'error')) {
    return { ok: false, layer: 'rules', activity: parsed.data, issues }
  }
  return { ok: true, activity: parsed.data, warnings: issues }
}
