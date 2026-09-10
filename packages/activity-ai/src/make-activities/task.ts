import type { ActivityAuthorRequest } from '@retenia/core'
import { looksLikeInjection, normalizeForInjectionScan } from '@retenia/core'
import { escapeForPrompt } from '../grade-long-text/task'

/**
 * The `{{task}}` block of `prompts/P4_make_activities/1.md`: one lesson's theory, the
 * misconceptions its material invites, and the one family this call may generate.
 *
 * Everything below came out of a model reading the learner's own documents — the theory P3
 * wrote from their book, the misconceptions P2 proposed — so it is escaped the same way the
 * grader escapes a learner's answer: a `</lesson><system>` in a source's prose must not close
 * a section it did not open. Suspicion is *reported* on the task and never acted on, which is
 * `packages/pathgen/src/extract/task.ts`'s rule and the same one for the same reason — the
 * bytes behind a `custom_id` cannot change because a heuristic fired.
 *
 * The identifiers our own pipeline minted — the family, the allowed types, the concept ids,
 * the misconception ids — sit **outside** the escaped sections, because they are what the
 * model is asked to copy rather than to read.
 */

export interface ActivityTask {
  readonly text: string
  readonly injectionSuspected: boolean
}

/** Blocks a practice writer has no use for: they frame the lesson rather than teach it. */
const SKIPPED_BLOCKS: readonly string[] = Object.freeze(['hook', 'activation_question'])

/** Enough theory to write an exercise about; past this the pool stops improving. */
export const MAX_BLOCK_CHARS = 2_000

function section(tag: string, body: string, attributes: Record<string, string> = {}): string {
  const attrs = Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${escapeForPrompt(value)}"`)
    .join('')
  return `<${tag}${attrs}>\n${body}\n</${tag}>`
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

export function buildActivityTask(
  request: ActivityAuthorRequest,
  family: string,
  types: readonly string[],
): ActivityTask {
  const suspect: string[] = []
  const watch = (text: string): string => {
    suspect.push(text)
    return escapeForPrompt(text)
  }

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

  const blocks = request.blocks
    .filter((block) => !SKIPPED_BLOCKS.includes(block.type))
    .map(
      (block) => `  <block type="${escapeForPrompt(block.type)}">
${watch(clamp(block.content, MAX_BLOCK_CHARS))}
  </block>`,
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

  const already =
    request.alreadyGenerated.length === 0
      ? ''
      : `\n${section(
          'already_generated',
          request.alreadyGenerated
            .map((prompt) => `  <prompt>${watch(clamp(prompt, 400))}</prompt>`)
            .join('\n'),
        )}\n`

  const text = [
    `family: ${family}`,
    `types: ${types.join(', ')}`,
    `language: ${request.lang}`,
    `wanted: ${request.wanted}`,
    `return: ${request.wanted * request.overGeneration} candidates`,
    '',
    section('lesson', [`  <title>${watch(request.title)}</title>`, objectives].join('\n')),
    section('concepts', concepts),
    section('theory', blocks),
    section('misconceptions', misconceptions),
    already,
    `Write ${request.wanted * request.overGeneration} candidates of family \`${family}\`, using`,
    'only the types listed above. Every wrong answer names the misconception it comes from.',
  ].join('\n')

  const injectionSuspected = suspect.some((value) =>
    looksLikeInjection(normalizeForInjectionScan(value)),
  )
  return { text, injectionSuspected }
}
