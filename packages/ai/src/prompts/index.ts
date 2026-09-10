/**
 * `@retenia/ai/prompts` — the versioned prompt registry and its template engine.
 *
 * The only Node-only entry point of this package: it reads `packages/ai/prompts/` from disk.
 * Callers that merely use a prompt take the rendered string, so nothing that runs in the
 * renderer or in Storybook reaches `node:fs` through here.
 */

export type { ParsedPromptFile, PromptFrontmatter } from './frontmatter'
export { PromptFrontmatterError, parsePromptFile, promptFrontmatterSchema } from './frontmatter'
export type { LoadedPrompt, PromptFileReader, PromptId, RenderedPrompt } from './registry'
export {
  isPromptId,
  loadPrompt,
  PROMPT_IDS,
  PROMPTS_ROOT,
  promptVersionSnapshot,
  renderPrompt,
  UnknownPromptError,
} from './registry'
export type { TemplateScope } from './template'
export { MissingPromptVariableError, PromptTemplateError, renderTemplate } from './template'
