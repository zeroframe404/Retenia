import { wrapUserContent } from '@retenia/ai'
import { MAX_LOCATOR_CHARS } from '../extract/task'
import type { TheoryBlock } from '../schemas/lesson'
import { headerLine, oneLine } from '../text'
import type { GlossaryTerm, LessonContext } from './context'

/**
 * The task half of a P5 call: the theory P3 wrote, the concepts it teaches, the fragments it
 * cited, and the fronts the path already has.
 *
 * The theory is model output written from the learner's documents, so it is `<user_content>`
 * like everything else that came out of a file; the cite ids, the concept ids and the
 * locators stay outside the envelope because they are what the model copies.
 */

export const MAX_BLOCK_CHARS = 2_000
export const MAX_FRONT_CHARS = 300
/** Enough for the model to avoid repeating itself without paying for the whole path. */
export const MAX_EXISTING_FRONTS = 60

export interface FlashcardTask {
  readonly prompt: string
  readonly injectionSuspected: boolean
}

export interface FlashcardTaskInput {
  readonly lessonSpecId: string
  readonly title: string
  readonly lang: string
  readonly blocks: readonly TheoryBlock[]
  readonly glossary: readonly GlossaryTerm[]
  readonly context: LessonContext
  /** Normalized fronts of the cards this path already has, newest last. */
  readonly existingFronts: readonly string[]
}

export function buildFlashcardTask(input: FlashcardTaskInput): FlashcardTask {
  const blocks: { text: string; injectionSuspected: boolean }[] = []
  const wrap = (text: string, label: string): string => {
    const wrapped = wrapUserContent(text, label)
    blocks.push(wrapped)
    return wrapped.text
  }

  const theory = input.blocks
    .map(
      (block) =>
        `### ${block.type}${block.citations.length === 0 ? '' : ` [${block.citations.join(', ')}]`}\n` +
        (block.content.length <= MAX_BLOCK_CHARS
          ? block.content
          : `${block.content.slice(0, MAX_BLOCK_CHARS)}…`),
    )
    .join('\n\n')

  const concepts = input.glossary
    .map(
      (term) =>
        `- ${term.conceptId}: ${oneLine(term.name, 200)} — ${oneLine(term.definition, 400)}`,
    )
    .join('\n')

  const citable = input.context.citable
    .map((fragment) => `- ${fragment.citeId} (${headerLine(fragment.locator, MAX_LOCATOR_CHARS)})`)
    .join('\n')

  const existing = input.existingFronts.slice(-MAX_EXISTING_FRONTS)

  const prompt = [
    `lesson_id: ${input.lessonSpecId}`,
    `language: ${headerLine(input.lang, 16)}`,
    `concept_ids: ${input.glossary.map((term) => term.conceptId).join(', ')}`,
    '',
    '## Title',
    wrap(input.title, 'lesson_title'),
    '',
    '## concepts',
    concepts === '' ? '(none listed)' : wrap(concepts, 'concepts'),
    '',
    '## citable',
    citable === '' ? '(no fragments — return no cards)' : citable,
    '',
    '## lesson',
    wrap(theory, 'lesson'),
    '',
    '## existing',
    existing.length === 0
      ? '(this path has no cards yet)'
      : wrap(
          existing.map((front) => `- ${oneLine(front, MAX_FRONT_CHARS)}`).join('\n'),
          'existing',
        ),
    '',
    'Write this lesson’s flashcards. Cite only the ids listed under `citable`, and say in',
    '`skipped` what you refused and why.',
  ].join('\n')

  return { prompt, injectionSuspected: blocks.some((block) => block.injectionSuspected) }
}
