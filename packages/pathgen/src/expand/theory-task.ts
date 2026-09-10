import { wrapUserContent } from '@retenia/ai'
import type { GenerationConfig } from '../config/generation-config'
import { MAX_LOCATOR_CHARS } from '../extract/task'
import type { CoreLessonNode } from '../schemas/path-draft'
import { headerLine, oneLine } from '../text'
import type { LessonContext } from './context'

/**
 * The task half of a P3 call: what `{{task}}` in `P3_write_lesson` receives.
 *
 * The split is `extract/task.ts`'s, for its reasons. Everything that came out of the
 * learner's files — the fragments, their headings, the concept names and definitions a model
 * wrote from them, the lesson titles — travels inside `<user_content>` blocks, because it is
 * text to read. The identifiers our own pipeline minted — the cite ids, the concept ids, the
 * locators, the language — sit outside, because they are what the model is asked to copy.
 *
 * A suspected injection is reported on the task and never acted on: the fragment still goes
 * to the model, wrapped, and the bytes behind the `custom_id` do not move because a heuristic
 * fired.
 */

export const MAX_TITLE_CHARS = 200
export const MAX_OBJECTIVE_CHARS = 300
export const MAX_DEFINITION_CHARS = 400

export interface TheoryTask {
  readonly prompt: string
  readonly injectionSuspected: boolean
}

export interface TheoryTaskInput {
  readonly lesson: CoreLessonNode
  readonly context: LessonContext
  readonly config: Pick<GenerationConfig, 'lessonLanguage' | 'level' | 'goal'>
  /** The path teaches a language, so §7's "lesson in Spanish, items in the target" applies. */
  readonly targetLanguage: string | null
  readonly minutes: number
}

export function buildTheoryTask(input: TheoryTaskInput): TheoryTask {
  const { lesson, context } = input
  const blocks: { text: string; injectionSuspected: boolean }[] = []
  const wrap = (text: string, label: string): string => {
    const wrapped = wrapUserContent(text, label)
    blocks.push(wrapped)
    return wrapped.text
  }

  const objectives = lesson.objectives
    .map((objective) => `- (${objective.bloom}) ${oneLine(objective.text, MAX_OBJECTIVE_CHARS)}`)
    .join('\n')

  const glossary = context.glossary
    .map(
      (term) =>
        `- ${term.conceptId}: ${oneLine(term.name, MAX_TITLE_CHARS)} — ` +
        oneLine(term.definition, MAX_DEFINITION_CHARS),
    )
    .join('\n')

  const previous =
    context.previous.length === 0
      ? '(this is the first lesson of its module)'
      : context.previous
          .map(
            (earlier) =>
              `- ${earlier.specId}: ${oneLine(earlier.title, MAX_TITLE_CHARS)}` +
              (earlier.objective === null
                ? ''
                : ` — ${oneLine(earlier.objective, MAX_OBJECTIVE_CHARS)}`),
          )
          .join('\n')

  // The whitelist. Cite ids and locators are ours; the heading is the document's, so it is
  // wrapped with the fragment it belongs to rather than listed here.
  const citable = context.citable
    .map((fragment) => `- ${fragment.citeId} (${headerLine(fragment.locator, MAX_LOCATOR_CHARS)})`)
    .join('\n')

  const sources = context.citable
    .map((fragment) =>
      [
        `### ${fragment.citeId}`,
        wrap(fragment.headingPath ?? '(no heading)', `heading_${fragment.citeId}`),
        wrap(fragment.text, `fragment_${fragment.citeId}`),
      ].join('\n'),
    )
    .join('\n\n')

  const language =
    input.targetLanguage === null
      ? `lesson_language: ${headerLine(input.config.lessonLanguage, 16)}`
      : `lesson_language: ${headerLine(input.config.lessonLanguage, 16)}\n` +
        `target_language: ${headerLine(input.targetLanguage, 16)} ` +
        '(write the lesson in `lesson_language`; the material being learned stays in ' +
        '`target_language`)'

  const prompt = [
    `lesson_id: ${lesson.id}`,
    language,
    `level: ${headerLine(input.config.level, 40)}`,
    `minutes: ${input.minutes}`,
    `concept_ids: ${lesson.concept_ids.join(', ')}`,
    ...(lesson.warmup_concept_ids.length === 0
      ? []
      : [`warmup_concept_id: ${lesson.warmup_concept_ids.join(', ')}`]),
    '',
    '## Title and objectives',
    wrap(lesson.title, 'lesson_title'),
    // `objective.text` is prose P2 wrote while reading the learner's documents, so it is read
    // rather than copied and belongs inside the envelope — the bloom label in front of it is a
    // schema enum and stays outside. Leaving the line bare would put source-derived text in the
    // same trust position as this task's own closing instruction, and would also keep it away
    // from `looksLikeInjection`, so the one poisoned field would be the one nothing reported.
    objectives === '' ? '(no objectives listed)' : wrap(objectives, 'objectives'),
    '',
    '## Goal of the path',
    wrap(input.config.goal, 'goal'),
    '',
    '## Glossary',
    glossary === '' ? '(no concepts listed)' : wrap(glossary, 'glossary'),
    '',
    '## Previous lessons of this module',
    context.previous.length === 0 ? previous : wrap(previous, 'previous'),
    '',
    '## citable',
    citable === '' ? '(no fragments — write a `general_knowledge` lesson and say so)' : citable,
    '',
    '## sources',
    sources,
    '',
    'Write this lesson. Cite only the ids listed under `citable`; a claim you cannot place in',
    'a fragment gets no citation and does not go in an `explanation`.',
  ].join('\n')

  return {
    prompt,
    injectionSuspected: blocks.some((block) => block.injectionSuspected),
  }
}
