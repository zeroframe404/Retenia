import type { ItemAuthorRequest } from '@retenia/core'
import { looksLikeInjection, normalizeForInjectionScan } from '@retenia/core'
import { escapeForPrompt } from '../grade-long-text/task'

/**
 * The `{{task}}` block of `prompts/P9_items/1.md`: one blueprint cell, the module it belongs
 * to, the misconceptions its distractors come from, the source excerpts the items must be
 * answerable from, and the stems they must not repeat.
 *
 * Escaped and scanned exactly as P4's task is (`make-activities/task.ts`): everything but the
 * identifiers our own pipeline minted came out of the learner's documents, and suspicion is
 * reported, never acted on — the bytes behind a `custom_id` cannot change because a
 * heuristic fired.
 */

export interface ItemTask {
  readonly text: string
  readonly injectionSuspected: boolean
}

/** Enough source to write an item from; past this the items stop improving. */
export const MAX_EXCERPT_CHARS = 1_500
export const MAX_EXCERPTS = 8
/** The stems to avoid are compared by meaning in code; the prompt needs only enough to steer. */
export const MAX_AVOID = 40
export const MAX_AVOID_CHARS = 300

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

function section(tag: string, body: string): string {
  return `<${tag}>\n${body}\n</${tag}>`
}

/** How many items the cell keeps: one per difficulty, per form when it has forms. */
export function wantedItems(request: ItemAuthorRequest): number {
  return request.cell.difficulties.length * Math.max(1, request.cell.forms.length)
}

export function buildItemTask(request: ItemAuthorRequest): ItemTask {
  const suspect: string[] = []
  const watch = (text: string): string => {
    suspect.push(text)
    return escapeForPrompt(text)
  }

  const { cell } = request
  const wanted = wantedItems(request)
  const objectives = request.objectives
    .map(
      (objective) => `  <objective bloom="${objective.bloom}">${watch(objective.text)}</objective>`,
    )
    .join('\n')
  const concepts = request.concepts
    .map(
      (concept) =>
        `  <concept id="${escapeForPrompt(concept.id)}">${watch(concept.name)} — ${watch(
          concept.definition,
        )}</concept>`,
    )
    .join('\n')
  const misconceptions = request.misconceptions
    .map(
      (misconception) =>
        `  <misconception id="${escapeForPrompt(misconception.id)}" concept="${escapeForPrompt(
          misconception.conceptId,
        )}">
    <belief>${watch(misconception.text)}</belief>
    <why_wrong>${watch(misconception.whyWrong)}</why_wrong>
  </misconception>`,
    )
    .join('\n')
  const excerpts = request.excerpts
    .slice(0, MAX_EXCERPTS)
    .map((excerpt) => `  <excerpt>\n${watch(clamp(excerpt, MAX_EXCERPT_CHARS))}\n  </excerpt>`)
    .join('\n')
  const avoid = request.avoid
    .slice(0, MAX_AVOID)
    .map((stem) => `  <stem>${watch(clamp(stem, MAX_AVOID_CHARS))}</stem>`)
    .join('\n')

  const text = [
    // Minted by our own code from positional ids, and still escaped: nothing in a header the
    // model reads should rely on the draft's ids staying tame.
    `cell: ${escapeForPrompt(cell.key)}`,
    `kind: ${cell.kind}`,
    `bloom: ${cell.bloom}`,
    `target_difficulties: ${cell.difficulties.join(', ')}`,
    `forms: ${cell.forms.length === 0 ? 'none (form: null)' : cell.forms.join(', ')}`,
    `language: ${request.lang}`,
    `wanted: ${wanted}`,
    `return: ${wanted * request.overGeneration} items`,
    '',
    section('module', [`  <title>${watch(request.moduleTitle)}</title>`, objectives].join('\n')),
    section('concepts', concepts),
    section('misconceptions', misconceptions),
    section('excerpts', excerpts),
    section('avoid', avoid),
    '',
    `Write ${wanted * request.overGeneration} items for this cell, following every NBME rule.`,
    'Every wrong option names the misconception it comes from in option_misconceptions.',
  ].join('\n')

  const injectionSuspected = suspect.some((value) =>
    looksLikeInjection(normalizeForInjectionScan(value)),
  )
  return { text, injectionSuspected }
}
