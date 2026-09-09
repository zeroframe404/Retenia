import type { ProviderRole } from '@retenia/ai'
import { USER_CONTENT_INSTRUCTIONS } from '@retenia/ai'
import { EXTRACT_CHUNK_SCHEMA_ID } from './schemas/extraction'
import { SYNTHESIZE_MODULE_SCHEMA_ID, SYNTHESIZE_OUTLINE_SCHEMA_ID } from './schemas/outline'

/**
 * The three prompt files this package runs, as the main process hands them in.
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
  /** `promptVersionSnapshot()` — every registered prompt, for the manifest. */
  readonly snapshot: Readonly<Record<string, string>>
}

/**
 * The system message of a prompt file: everything above `{{task}}`, plus the paragraph that
 * gives the `<user_content>` envelope its meaning, appended exactly once so `withCache` — which
 * appends it when missing — finds it already there and the cached prefix stays byte-identical
 * between the two call paths.
 */
export function systemFor(template: string): string {
  const system = template.replace('{{task}}', '').trimEnd()
  return system.includes(USER_CONTENT_INSTRUCTIONS)
    ? system
    : `${system}\n\n${USER_CONTENT_INSTRUCTIONS}`
}

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
  const expected: ReadonlyArray<readonly [string, PathgenPrompt, string]> = [
    [PATHGEN_PROMPT_IDS.extract, prompts.extract, EXTRACT_CHUNK_SCHEMA_ID],
    [PATHGEN_PROMPT_IDS.outline, prompts.outline, SYNTHESIZE_OUTLINE_SCHEMA_ID],
    [PATHGEN_PROMPT_IDS.module, prompts.module, SYNTHESIZE_MODULE_SCHEMA_ID],
  ]
  for (const [id, prompt, schema] of expected) {
    if (prompt.schemaVersion !== schema) {
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
