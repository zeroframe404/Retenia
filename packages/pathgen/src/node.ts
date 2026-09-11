import type { PromptFileReader } from '@retenia/ai/prompts'
import { loadPrompt, promptVersionSnapshot } from '@retenia/ai/prompts'
import {
  assertPathgenPrompts,
  PATHGEN_PROMPT_IDS,
  type PathgenPrompt,
  type PathgenPrompts,
} from './prompts'

/**
 * `@retenia/pathgen/node` — the one Node-only door of this package: reads the nine prompt
 * files through `@retenia/ai/prompts` (which reads the disk) and hands back the bundle the
 * pure entry point takes. Main calls it once at startup; the tests call it to run the real
 * prompts through the pipeline.
 */

function toPathgenPrompt(
  id: (typeof PATHGEN_PROMPT_IDS)[keyof typeof PATHGEN_PROMPT_IDS],
  read?: PromptFileReader,
): PathgenPrompt {
  const loaded = loadPrompt(id, undefined, read)
  return {
    template: loaded.template,
    promptVersion: loaded.promptVersion,
    schemaVersion: loaded.frontmatter.schema,
    role: loaded.frontmatter.role,
    temperature: loaded.frontmatter.temperature,
  }
}

/**
 * `read` is how the caller says where the files are.
 *
 * The default reads `packages/ai/prompts/` from disk, which is right under vitest and `tsx`.
 * The Electron main process passes `@retenia/ai/prompts-bundled`'s reader instead, because a
 * bundled `@retenia/ai` resolves `PROMPTS_ROOT` relative to `out/main/index.js` and would
 * look for the files somewhere they have never been.
 */
export function loadPathgenPrompts(read?: PromptFileReader): PathgenPrompts {
  return assertPathgenPrompts({
    extract: toPathgenPrompt(PATHGEN_PROMPT_IDS.extract, read),
    outline: toPathgenPrompt(PATHGEN_PROMPT_IDS.outline, read),
    module: toPathgenPrompt(PATHGEN_PROMPT_IDS.module, read),
    lesson: toPathgenPrompt(PATHGEN_PROMPT_IDS.lesson, read),
    activities: toPathgenPrompt(PATHGEN_PROMPT_IDS.activities, read),
    flashcards: toPathgenPrompt(PATHGEN_PROMPT_IDS.flashcards, read),
    faithfulness: toPathgenPrompt(PATHGEN_PROMPT_IDS.faithfulness, read),
    judge: toPathgenPrompt(PATHGEN_PROMPT_IDS.judge, read),
    edit: toPathgenPrompt(PATHGEN_PROMPT_IDS.edit, read),
    items: toPathgenPrompt(PATHGEN_PROMPT_IDS.items, read),
    snapshot: promptVersionSnapshot(),
  })
}
