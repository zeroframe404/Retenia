import type { AiBinding, BatchRequest, StructuredObjectRequest } from '@retenia/ai'
import { customId, structuredRequestFor } from '@retenia/ai'
import type { AbortSignalLike } from '@retenia/core'
import { GENERATION_PURPOSE } from '../extract/request'
import { PATHGEN_PROMPT_IDS, type PathgenPrompt, systemFor } from '../prompts'
import {
  MAKE_FLASHCARDS_SCHEMA_NAME,
  type MakeFlashcardsOutput,
  makeFlashcardsOutputSchema,
} from '../schemas/flashcards'
import {
  WRITE_LESSON_SCHEMA_NAME,
  type WriteLessonOutput,
  writeLessonOutputSchema,
} from '../schemas/lesson'
import { contextKeyParts } from './context'
import { buildFlashcardTask, type FlashcardTaskInput } from './flashcards-task'
import { buildTheoryTask, type TheoryTaskInput } from './theory-task'

/**
 * The P3 and P5 calls, in both shapes they can be dispatched in — the arrangement
 * `extract/request.ts` established: `structured` goes through `AiClient.structured`
 * (validated, repaired, budgeted, logged and cached), `batch` is the byte-identical transport
 * request the runner submits, and `structuredRequestFor` is what keeps them identical so an
 * answer paid for on one path is found on the other.
 *
 * **What is in a lesson's `custom_id`, and what is deliberately not.**
 *
 * In: what the model reads. The lesson's teaching content (its title, objectives, concepts and
 * budget), the fragments the context builder actually sent *after* the token budget trimmed
 * them, the previous-lesson summary, the glossary, and the path's language, level and goal.
 *
 * Out: the lesson's **positional id**. `sequencing/ids.ts` assigns `L07` by position and §7
 * says the stable identity is the concept, not the slot — a regenerated path that moves one
 * module would otherwise pay again for forty unchanged lessons. Out too: the path version's
 * id, for the same reason. Two lessons that teach the same concepts from the same fragments
 * in the same language *are* the same call, and the second one should be free.
 *
 * `revision` is the "Regenerar" counter, which does belong: it is the one input that says
 * "not that answer, a different one".
 */

export const WRITE_LESSON_STAGE = PATHGEN_PROMPT_IDS.lesson
export const MAKE_FLASHCARDS_STAGE = PATHGEN_PROMPT_IDS.flashcards

/** 1,200 words of Markdown with citations and a diagram is ~4,000 tokens; twice that is room. */
export const WRITE_LESSON_MAX_OUTPUT_TOKENS = 8_000
/** Twelve cards with their cloze text and cues; a full answer is ~1,200 tokens. */
export const MAKE_FLASHCARDS_MAX_OUTPUT_TOKENS = 4_000

export function expansionBinding(
  prompt: PathgenPrompt,
  stage: string,
  options: { readonly allowOverBudget?: boolean; readonly force?: boolean } = {},
): AiBinding {
  return {
    role: prompt.role,
    purpose: GENERATION_PURPOSE,
    stage,
    promptVersion: prompt.promptVersion,
    schemaVersion: prompt.schemaVersion,
    ...(options.allowOverBudget === true ? { allowOverBudget: true } : {}),
    // "Regenerar" (§13 step 5): skip the cache *and replace* the answer in it, which is what
    // `AiBinding.force` is documented to do. The alternative — a nonce in the key — would
    // accumulate two answers to one question and leave the old one billable for ever.
    ...(options.force === true ? { force: true } : {}),
  }
}

export interface TheoryRequest {
  readonly customId: string
  readonly injectionSuspected: boolean
  readonly structured: StructuredObjectRequest<WriteLessonOutput>
  readonly batch: BatchRequest
}

export interface RequestOptions {
  readonly system?: string
  readonly cachePrefix?: string
  readonly cache?: StructuredObjectRequest<unknown>['cache']
  readonly signal?: AbortSignalLike
}

export function theoryCustomId(
  input: Pick<TheoryTaskInput, 'lesson' | 'context' | 'config' | 'targetLanguage' | 'minutes'>,
  prompt: PathgenPrompt,
  revision: number,
): string {
  const { lesson } = input
  return customId({
    stage: WRITE_LESSON_STAGE,
    inputIds: [
      'lesson',
      lesson.title,
      ...lesson.objectives.map((objective) => `${objective.bloom}:${objective.text}`),
      ...lesson.concept_ids,
      ...lesson.warmup_concept_ids,
      String(input.minutes),
      'ctx',
      ...contextKeyParts(input.context),
      'cfg',
      input.config.lessonLanguage,
      input.config.level,
      input.config.goal,
      input.targetLanguage ?? '',
      'rev',
      String(revision),
    ],
    promptVersion: prompt.promptVersion,
    schemaVersion: prompt.schemaVersion,
  })
}

export function buildTheoryRequest(
  input: TheoryTaskInput,
  prompt: PathgenPrompt,
  revision: number,
  options: RequestOptions = {},
): TheoryRequest {
  const id = theoryCustomId(input, prompt, revision)
  const task = buildTheoryTask(input)
  const structured: StructuredObjectRequest<WriteLessonOutput> = {
    system: options.system ?? systemFor(prompt.template),
    prompt: task.prompt,
    temperature: prompt.temperature,
    schema: writeLessonOutputSchema,
    schemaName: WRITE_LESSON_SCHEMA_NAME,
    maxOutputTokens: WRITE_LESSON_MAX_OUTPUT_TOKENS,
    idempotencyKey: id,
    ...(options.cachePrefix === undefined ? {} : { cachePrefix: options.cachePrefix }),
    ...(options.cache === undefined ? {} : { cache: options.cache }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  return {
    customId: id,
    injectionSuspected: task.injectionSuspected,
    structured,
    batch: { customId: id, request: structuredRequestFor(structured) },
  }
}

export interface FlashcardRequest {
  readonly customId: string
  readonly injectionSuspected: boolean
  readonly structured: StructuredObjectRequest<MakeFlashcardsOutput>
  readonly batch: BatchRequest
}

/**
 * Parented on the P3 call: the same theory is the same input, so a lesson whose theory came
 * back from the cache gets its cards from the cache too, and a regenerated theory regenerates
 * them. There is no variant counter here — "Más ejemplos" adds exercises, not cards.
 */
export function flashcardCustomId(parentCustomId: string, prompt: PathgenPrompt): string {
  return customId({
    stage: MAKE_FLASHCARDS_STAGE,
    inputIds: [parentCustomId],
    promptVersion: prompt.promptVersion,
    schemaVersion: prompt.schemaVersion,
  })
}

export function buildFlashcardRequest(
  input: FlashcardTaskInput,
  parentCustomId: string,
  prompt: PathgenPrompt,
  options: RequestOptions = {},
): FlashcardRequest {
  const id = flashcardCustomId(parentCustomId, prompt)
  const task = buildFlashcardTask(input)
  const structured: StructuredObjectRequest<MakeFlashcardsOutput> = {
    system: options.system ?? systemFor(prompt.template),
    prompt: task.prompt,
    temperature: prompt.temperature,
    schema: makeFlashcardsOutputSchema,
    schemaName: MAKE_FLASHCARDS_SCHEMA_NAME,
    maxOutputTokens: MAKE_FLASHCARDS_MAX_OUTPUT_TOKENS,
    idempotencyKey: id,
    ...(options.cachePrefix === undefined ? {} : { cachePrefix: options.cachePrefix }),
    ...(options.cache === undefined ? {} : { cache: options.cache }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  return {
    customId: id,
    injectionSuspected: task.injectionSuspected,
    structured,
    batch: { customId: id, request: structuredRequestFor(structured) },
  }
}
