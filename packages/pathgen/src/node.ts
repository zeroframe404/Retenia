import { loadPrompt, promptVersionSnapshot } from '@retenia/ai/prompts'
import {
  assertPathgenPrompts,
  PATHGEN_PROMPT_IDS,
  type PathgenPrompt,
  type PathgenPrompts,
} from './prompts'

/**
 * `@retenia/pathgen/node` — the one Node-only door of this package: reads the three prompt
 * files through `@retenia/ai/prompts` (which reads the disk) and hands back the bundle the
 * pure entry point takes. Main calls it once at startup; the tests call it to run the real
 * prompts through the pipeline.
 */

function toPathgenPrompt(
  id: (typeof PATHGEN_PROMPT_IDS)[keyof typeof PATHGEN_PROMPT_IDS],
): PathgenPrompt {
  const loaded = loadPrompt(id)
  return {
    template: loaded.template,
    promptVersion: loaded.promptVersion,
    schemaVersion: loaded.frontmatter.schema,
    role: loaded.frontmatter.role,
    temperature: loaded.frontmatter.temperature,
  }
}

export function loadPathgenPrompts(): PathgenPrompts {
  return assertPathgenPrompts({
    extract: toPathgenPrompt(PATHGEN_PROMPT_IDS.extract),
    outline: toPathgenPrompt(PATHGEN_PROMPT_IDS.outline),
    module: toPathgenPrompt(PATHGEN_PROMPT_IDS.module),
    snapshot: promptVersionSnapshot(),
  })
}
