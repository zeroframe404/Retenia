import type { ProviderRole } from '@retenia/ai'
import { EXTRACT_CHUNK_SCHEMA_ID } from './schemas/extraction'
import { MAKE_FLASHCARDS_SCHEMA_ID } from './schemas/flashcards'
import { WRITE_LESSON_SCHEMA_ID } from './schemas/lesson'
import { SYNTHESIZE_MODULE_SCHEMA_ID, SYNTHESIZE_OUTLINE_SCHEMA_ID } from './schemas/outline'
import {
  EDIT_LESSON_SCHEMA_ID,
  FAITHFULNESS_SCHEMA_ID,
  PEDAGOGY_JUDGE_SCHEMA_ID,
} from './schemas/qa'

/**
 * The nine prompt files this package runs, as the main process hands them in.
 *
 * `@retenia/ai/prompts` is Node-only (it reads `packages/ai/prompts/` from disk), so the
 * pure entry point takes the *loaded* prompts rather than loading them — the same convention
 * `@retenia/ingest`'s contextualiser and `@retenia/activity-ai`'s grader follow. `./node`
 * exports the loader for main and for tests.
 */

export const PATHGEN_PROMPT_IDS = {
  extract: 'P1_extract_chunk',
  outline: 'P2_synthesize_outline',
  module: 'P2_synthesize_module',
  lesson: 'P3_write_lesson',
  activities: 'P4_make_activities',
  flashcards: 'P5_make_flashcards',
  faithfulness: 'P6_faithfulness',
  judge: 'P7_pedagogy_judge',
  edit: 'P8_edit',
  items: 'P9_items',
} as const

export interface PathgenPrompt {
  /** The file's body, `{{task}}` placeholder included. */
  readonly template: string
  /** The `version:` line — the `promptVersion` half of every custom id. */
  readonly promptVersion: string
  /** The `schema:` line — the `schemaVersion` half. */
  readonly schemaVersion: string
  readonly role: ProviderRole
  readonly temperature: number
}

export interface PathgenPrompts {
  readonly extract: PathgenPrompt
  readonly outline: PathgenPrompt
  readonly module: PathgenPrompt
  readonly lesson: PathgenPrompt
  /**
   * P4. Its answers are parsed by `@retenia/activity-ai`, not here — this package only
   * dispatches them — so `assertPathgenPrompts` checks its `{{task}}` placeholder and leaves
   * the schema-id check to `createActivityAuthor`, which owns the parser.
   */
  readonly activities: PathgenPrompt
  readonly flashcards: PathgenPrompt
  /** P6 — stage 8's per-claim verifier, on the `cheap` role at temperature 0. */
  readonly faithfulness: PathgenPrompt
  /** P7 — stage 8's pedagogy judge, on the `judge` role (never the generator's) at temperature 0. */
  readonly judge: PathgenPrompt
  /** P8 — stage 8's critic-editor. */
  readonly edit: PathgenPrompt
  /**
   * P9 — stage 9's item bank. Parsed by `@retenia/activity-ai`'s `createItemAuthor`, like P4,
   * so its schema id is checked there and only its placeholder and temperature here.
   */
  readonly items: PathgenPrompt
  /** `promptVersionSnapshot()` — every registered prompt, for the manifest. */
  readonly snapshot: Readonly<Record<string, string>>
}

/**
 * `systemFor` lives in `@retenia/ai` — `@retenia/activity-ai` needs it too, since P4 builds
 * its own requests — and is re-exported here so every caller of this package still finds it
 * where it has always been.
 */
export { systemFor } from '@retenia/ai'

/** §9's P5 temperature, with room for a small tuning but not for a writing temperature. */
export const MAX_FLASHCARD_TEMPERATURE = 0.4

/**
 * §9 puts P4 at 0.7, and the band around it is what "varied pool" means operationally.
 *
 * Below the floor the two-to-three-times over-generation stops paying for itself — twenty
 * near-identical candidates filter down to the same four — and above the ceiling the
 * distractors stop being the misconceptions they are supposed to be derived from. Wide enough
 * to tune, narrow enough to catch a file re-pointed at another prompt's temperature.
 */
export const P4_TEMPERATURE_RANGE = Object.freeze({ min: 0.5, max: 1 })

export class PathgenPromptError extends Error {
  override readonly name = 'PathgenPromptError'
}

/**
 * The invariants of `docs/spec/04-path-generation.md` §7 and §9 the bundle must satisfy:
 * extraction is deterministic (temperature 0), and each file validates against the schema
 * this package will parse its answers with — a prompt file re-pointed at another schema
 * version would otherwise be cached under one shape and parsed as another.
 */
export function assertPathgenPrompts(prompts: PathgenPrompts): PathgenPrompts {
  if (prompts.extract.temperature !== 0) {
    throw new PathgenPromptError(
      `${PATHGEN_PROMPT_IDS.extract} must run at temperature 0 (it runs at ${prompts.extract.temperature})`,
    )
  }
  // §9 puts P5 at 0.3: a flashcard's value is in being minimal and unambiguous, and the twenty
  // rules of §1.2 are constraints rather than a style to vary. The ceiling is deliberately
  // loose — it catches a file re-pointed at a writing temperature, not a tuning of 0.3 to 0.35.
  if (prompts.flashcards.temperature > MAX_FLASHCARD_TEMPERATURE) {
    throw new PathgenPromptError(
      `${PATHGEN_PROMPT_IDS.flashcards} must stay near-deterministic (§9 puts P5 at 0.3; ` +
        `it runs at ${prompts.flashcards.temperature})`,
    )
  }
  // §9 puts P9 at 0.7 too, for the same reason: over-generate a varied pool, keep what passes.
  for (const [id, prompt] of [
    [PATHGEN_PROMPT_IDS.activities, prompts.activities],
    [PATHGEN_PROMPT_IDS.items, prompts.items],
  ] as const) {
    const { temperature } = prompt
    if (temperature < P4_TEMPERATURE_RANGE.min || temperature > P4_TEMPERATURE_RANGE.max) {
      throw new PathgenPromptError(
        `${id} must stay near §9's 0.7 (it runs at ${temperature}, ` +
          `outside ${P4_TEMPERATURE_RANGE.min}–${P4_TEMPERATURE_RANGE.max})`,
      )
    }
  }
  // §7 and §9: the verifier and the judge are deterministic — a threshold of 0.9 or of 3
  // means nothing over an answer that varies between runs.
  for (const [id, prompt] of [
    [PATHGEN_PROMPT_IDS.faithfulness, prompts.faithfulness],
    [PATHGEN_PROMPT_IDS.judge, prompts.judge],
  ] as const) {
    if (prompt.temperature !== 0) {
      throw new PathgenPromptError(
        `${id} must run at temperature 0 (it runs at ${prompt.temperature})`,
      )
    }
  }
  // §5 gate 9 and §14 pitfall 16: the judge is a model different from the generator, and the
  // `judge` role is what carries that rule through the role map. A prompt file re-pointed at
  // `smart` would have the lesson's author grade its own work.
  if (prompts.judge.role !== 'judge') {
    throw new PathgenPromptError(
      `${PATHGEN_PROMPT_IDS.judge} must run on the "judge" role, never on the generator's ` +
        `(it declares "${prompts.judge.role}")`,
    )
  }
  const expected: ReadonlyArray<readonly [string, PathgenPrompt, string | null]> = [
    [PATHGEN_PROMPT_IDS.extract, prompts.extract, EXTRACT_CHUNK_SCHEMA_ID],
    [PATHGEN_PROMPT_IDS.outline, prompts.outline, SYNTHESIZE_OUTLINE_SCHEMA_ID],
    [PATHGEN_PROMPT_IDS.module, prompts.module, SYNTHESIZE_MODULE_SCHEMA_ID],
    [PATHGEN_PROMPT_IDS.lesson, prompts.lesson, WRITE_LESSON_SCHEMA_ID],
    [PATHGEN_PROMPT_IDS.activities, prompts.activities, null],
    [PATHGEN_PROMPT_IDS.flashcards, prompts.flashcards, MAKE_FLASHCARDS_SCHEMA_ID],
    [PATHGEN_PROMPT_IDS.faithfulness, prompts.faithfulness, FAITHFULNESS_SCHEMA_ID],
    [PATHGEN_PROMPT_IDS.judge, prompts.judge, PEDAGOGY_JUDGE_SCHEMA_ID],
    [PATHGEN_PROMPT_IDS.edit, prompts.edit, EDIT_LESSON_SCHEMA_ID],
    [PATHGEN_PROMPT_IDS.items, prompts.items, null],
  ]
  for (const [id, prompt, schema] of expected) {
    if (schema !== null && prompt.schemaVersion !== schema) {
      throw new PathgenPromptError(
        `${id} declares schema "${prompt.schemaVersion}" but this package parses "${schema}"`,
      )
    }
    if (!prompt.template.includes('{{task}}')) {
      throw new PathgenPromptError(`${id} has no {{task}} placeholder`)
    }
  }
  return prompts
}
