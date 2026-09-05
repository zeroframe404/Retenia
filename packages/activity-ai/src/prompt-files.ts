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

export type PromptId = 'grade_long_text' | 'explain_answer'

export function loadPrompt(id: PromptId): string {
  return readFileSync(join(PROMPTS_ROOT, `${id}.md`), 'utf-8')
}

/** P10 (`docs/spec/04-path-generation.md` §9): the free-text rubric grader. */
export function loadGradeLongTextPrompt(): string {
  return loadPrompt('grade_long_text')
}

/** §9's "Explain my answer". */
export function loadExplainAnswerPrompt(): string {
  return loadPrompt('explain_answer')
}
