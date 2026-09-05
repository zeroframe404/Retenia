import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Reads the versioned prompt files under `packages/activity-ai/prompts/`.
 *
 * A separate entry point (`@retenia/activity-ai/prompts`) because this is the only Node-only
 * module in the package: the graders themselves take the template as a string, so the renderer
 * and Storybook can import `@retenia/activity-ai` without dragging `node:fs` into a bundle. The
 * prompts stay Markdown files on disk rather than string literals so a change to one is a
 * reviewable diff, and so sub-phase 7.2's versioned prompt loader inherits them unchanged.
 */

export const PROMPTS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts')

/**
 * The prompt files, as a literal map rather than a filename built from the id.
 *
 * `PromptId` is a compile-time union and nothing more: sub-phase 7.2's versioned loader will
 * plausibly take an id from settings or the database, and `join(root, `${id}.md`)` would then
 * read whatever `../../../../etc/passwd` resolves to. A lookup cannot traverse.
 */
const PROMPT_FILES = {
  grade_long_text: 'grade_long_text.md',
  explain_answer: 'explain_answer.md',
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
  // `id` is typed, but the caller may be reading it out of a settings row at runtime.
  if (file === undefined) throw new UnknownPromptError(id)
  return readFileSync(join(PROMPTS_ROOT, file), 'utf-8')
}

/** P10 (`docs/spec/04-path-generation.md` §9): the free-text rubric grader. */
export function loadGradeLongTextPrompt(): string {
  return loadPrompt('grade_long_text')
}

/** §9's "Explain my answer". */
export function loadExplainAnswerPrompt(): string {
  return loadPrompt('explain_answer')
}
