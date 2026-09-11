import type { RemediationAuthorRequest } from '@retenia/core'
import { looksLikeInjection, normalizeForInjectionScan } from '@retenia/core'
import { escapeForPrompt } from '../grade-long-text/task'

/**
 * The `{{task}}` block of `prompts/P11_remediation/1.md`: the concept, the misconception, the
 * learner's errors, the fragments the explanation may cite, and the stems not to repeat.
 *
 * Escaped and scanned like P9's task (`make-items/task.ts`) — and with one more reason to be:
 * the errors are the learner's own answers, which is text nobody vetted.
 */

export interface RemediationTask {
  readonly text: string
  readonly injectionSuspected: boolean
}

export const MAX_REMEDIATION_FRAGMENTS = 6
export const MAX_REMEDIATION_FRAGMENT_CHARS = 1_800
export const MAX_REMEDIATION_ERRORS = 6
export const MAX_REMEDIATION_ERROR_CHARS = 400
export const MAX_REMEDIATION_AVOID = 20
export const MAX_REMEDIATION_AVOID_CHARS = 300

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

function section(tag: string, body: string): string {
  return `<${tag}>\n${body}\n</${tag}>`
}

export function buildRemediationTask(request: RemediationAuthorRequest): RemediationTask {
  const suspect: string[] = []
  const watch = (text: string): string => {
    suspect.push(text)
    return escapeForPrompt(text)
  }

  const { concept, misconception } = request
  const conceptBody = `  <id>${escapeForPrompt(concept.id)}</id>\n  <name>${watch(
    concept.name,
  )}</name>\n  <definition>${watch(concept.definition)}</definition>`
  const misconceptionBody =
    misconception === null
      ? '  none'
      : `  <id>${escapeForPrompt(misconception.id)}</id>\n  <belief>${watch(
          misconception.text,
        )}</belief>\n  <why_wrong>${watch(misconception.whyWrong)}</why_wrong>`
  const errors = request.errors
    .slice(0, MAX_REMEDIATION_ERRORS)
    .map(
      (error) =>
        `  <error>\n    <stem>${watch(clamp(error.stem, MAX_REMEDIATION_ERROR_CHARS))}</stem>\n` +
        `    <chosen>${error.chosen === null ? '' : watch(clamp(error.chosen, MAX_REMEDIATION_ERROR_CHARS))}</chosen>\n` +
        `    <correct>${error.correct === null ? '' : watch(clamp(error.correct, MAX_REMEDIATION_ERROR_CHARS))}</correct>\n  </error>`,
    )
    .join('\n')
  const fragments = request.excerpts
    .slice(0, MAX_REMEDIATION_FRAGMENTS)
    .map(
      (excerpt) =>
        `  <fragment id="${escapeForPrompt(excerpt.citeId)}" locator="${escapeForPrompt(
          excerpt.locator,
        )}">\n${watch(clamp(excerpt.text, MAX_REMEDIATION_FRAGMENT_CHARS))}\n  </fragment>`,
    )
    .join('\n')
  const avoid = request.avoid
    .slice(0, MAX_REMEDIATION_AVOID)
    .map((stem) => `  <stem>${watch(clamp(stem, MAX_REMEDIATION_AVOID_CHARS))}</stem>`)
    .join('\n')

  const text = [
    `detour: ${escapeForPrompt(request.specId)}`,
    `language: ${request.lang}`,
    `items_wanted: ${request.itemsWanted}`,
    '',
    section('concept', conceptBody),
    section('misconception', misconceptionBody),
    section('anchor', `  <title>${watch(request.anchorTitle)}</title>`),
    section('errors', errors === '' ? '  none' : errors),
    section('fragments', fragments === '' ? '  none' : fragments),
    section('avoid', avoid === '' ? '  none' : avoid),
    '',
    `Write the detour: a new angle on the concept, exactly one worked example, and exactly ${request.itemsWanted} items.`,
  ].join('\n')

  const injectionSuspected = suspect.some((value) =>
    looksLikeInjection(normalizeForInjectionScan(value)),
  )
  return { text, injectionSuspected }
}
