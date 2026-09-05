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

/**
 * Layer 3 of `docs/spec/03-activities.md` §11 — *"another model solves the item without seeing the
 * key; if it disagrees, `needsReview`"* — is **not here, and not anywhere yet**.
 *
 * It is deliberately absent rather than stubbed. A critic needs a provider, so it belongs in a
 * package that may talk to one (`activity-ai`), and it needs a caller that dispatches per type,
 * which is a sub-phase 8.4 concern (the judge of `docs/spec/04-path-generation.md` §9, prompts
 * P6–P8). It also needs something this package does not yet have: a *key-stripped* view of an
 * activity. §11's constraint is not "call a model", it is "without seeing the key", and every
 * shape that could be written today — `(activity: Activity) => Promise<Issue[]>` — hands the
 * critic `correctOrder`, `options[].correct` and `answers[]` along with the question. Writing that
 * signature now would fix the wrong contract in two packages for a caller that does not exist, so
 * 8.4 introduces the projection, the signature and the dispatcher together.
 *
 * Layers 1 and 2, below, are complete and are what the fixtures, the importers and the generation
 * pipeline run today.
 */

export type CheckResult =
  | { ok: true; activity: Activity; warnings: Issue[] }
  | { ok: false; layer: 'schema'; issues: Issue[] }
  | { ok: false; layer: 'rules'; activity: Activity; issues: Issue[] }

/**
 * Layers 1 and 2 over raw JSON: zod first, then the rules. `ok` means no `error`.
 *
 * Synchronous, and that is a property callers can rely on: the fixtures suite, the generation
 * pipeline and the importers all run this check in bulk, and nothing in layers 1 and 2 is remote.
 * When 8.4 adds layer 3 it takes its own asynchronous entry point that delegates here, so the two
 * can never disagree about the first two layers.
 */
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
