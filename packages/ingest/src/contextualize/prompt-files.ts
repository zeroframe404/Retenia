import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Reads the versioned prompt files under `packages/ingest/prompts/`.
 *
 * A separate entry point (`@retenia/ingest/prompts`) for the same reason
 * `@retenia/activity-ai/prompts` is one: everything else in this package takes the template as
 * a string, so nothing that only wants the pure chunker has to drag `node:fs` in with it. The
 * prompts stay Markdown on disk rather than string literals so a change to one is a reviewable
 * diff, and so sub-phase 7.2's versioned prompt loader inherits them unchanged.
 */

export const PROMPTS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prompts')

/** A literal map, not a filename built from the id — the same traversal argument as
 *  `@retenia/activity-ai`'s loader: an id read out of a settings row must not be able to name
 *  a path. */
const PROMPT_FILES = {
  contextualize: 'contextualize.md',
} as const satisfies Record<string, string>

export type PromptId = keyof typeof PROMPT_FILES

export class UnknownPromptError extends Error {
  constructor(id: string) {
    super(`No prompt file is registered under "${id}"`)
    this.name = 'UnknownPromptError'
  }
}

export function loadPrompt(id: PromptId): string {
  const file = PROMPT_FILES[id]
  if (file === undefined) throw new UnknownPromptError(id)
  return readFileSync(join(PROMPTS_ROOT, file), 'utf-8')
}

/**
 * The `version:` line of a prompt file's frontmatter.
 *
 * It is the version half of §7's idempotency key, `hash(stage, input_ids, prompt_version)`.
 * Read from the file rather than restated in code: a hardcoded `'1'` would go on saying `'1'`
 * after the prompt was rewritten, and a resumed batch run would then reuse answers the old
 * wording produced. Falls back to the file's own hash-free default when the frontmatter is
 * missing, which is a version that at least changes when the file does not parse.
 */
export function readPromptVersion(prompt: string): string {
  const match = /^---\r?\n[\s\S]*?^version:\s*(\S+)\s*$/m.exec(prompt)
  return match?.[1] ?? '0'
}

/** Stage 2's "contextual retrieval" prompt (`docs/spec/05-ingestion-rag.md` §4.2). */
export function loadContextualizePrompt(): string {
  return loadPrompt('contextualize')
}
