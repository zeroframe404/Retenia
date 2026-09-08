import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PromptFrontmatter } from './frontmatter'
import { parsePromptFile } from './frontmatter'
import type { TemplateScope } from './template'
import { renderTemplate } from './template'

/**
 * The versioned prompt registry (`packages/ai/prompts/<id>/<version>.md`).
 *
 * Three properties are the whole point of it, and each of them is a specific requirement:
 *
 * 1. **Every prompt has a version, and it is a file rather than a field.**
 *    `docs/spec/04-path-generation.md` §7 puts `prompt_versions` in the manifest of every
 *    generated path, and §7's idempotency key is `hash(stage, input_ids, prompt_version)`.
 *    Because a new version is a new *file*, the old one stays readable: a path generated in
 *    March can be explained in June by reading the prompt that generated it, and a resumed
 *    batch keyed on `prompt_version: 1` still means what it meant.
 * 2. **The id can never name a path.** `PROMPTS` is a literal map, so a prompt id read out
 *    of a settings row or a `PathSpec` cannot resolve to `../../../../etc/passwd` — the same
 *    argument the loaders this replaces made, kept because it is still correct.
 * 3. **One registry, not one per package.** Before 7.2 the P10 grader's prompt lived in
 *    `@retenia/activity-ai` and the contextualiser's in `@retenia/ingest`, each with its own
 *    loader and its own frontmatter convention. A manifest that has to snapshot "the prompt
 *    versions this path was built with" cannot be assembled from loaders it does not know
 *    about; `promptVersionSnapshot()` can only exist because there is one place to ask.
 *
 * Node-only, and therefore a separate entry point (`@retenia/ai/prompts`): everything that
 * merely *uses* a prompt takes the rendered string, so the renderer and Storybook never pull
 * `node:fs` into a bundle.
 */

export const PROMPTS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prompts')

/**
 * Every registered prompt, and the versions of it that exist.
 *
 * Versions are listed oldest first; the last is what `renderPrompt` uses when no version is
 * asked for. Adding a version means adding the file *and* the entry, which is deliberate: the
 * default version changing is a decision, not a consequence of a file appearing on disk.
 */
const PROMPTS = {
  /** P10 of `docs/spec/04-path-generation.md` §9 — the free-text rubric grader (5.5). */
  grade_long_text: [1],
  /** §9's "Explain my answer" (5.5). */
  explain_answer: [1],
  /** Stage 2 of §3, `docs/spec/05-ingestion-rag.md` §4.2 — contextual retrieval (6.2). */
  contextualize: [1],
} as const satisfies Record<string, readonly number[]>

export type PromptId = keyof typeof PROMPTS

export const PROMPT_IDS = Object.keys(PROMPTS) as PromptId[]

export class UnknownPromptError extends Error {
  override readonly name = 'UnknownPromptError'
  constructor(id: string, version?: number) {
    super(
      version === undefined
        ? `no prompt is registered under "${id}"`
        : `the "${id}" prompt has no version ${version}`,
    )
  }
}

export interface LoadedPrompt {
  readonly id: PromptId
  /** The template, frontmatter removed. */
  readonly template: string
  readonly frontmatter: PromptFrontmatter
  /** `"1"` — a string, because that is what `ai_calls.prompt_version` and `custom_id` take. */
  readonly promptVersion: string
}

export interface RenderedPrompt {
  /** The rendered prompt, ready to be a system message. */
  readonly text: string
  readonly promptVersion: string
  /** The frontmatter's `schema` field, for the other half of the idempotency key. */
  readonly schemaVersion: string
  readonly frontmatter: PromptFrontmatter
}

/** Parsed once per file. Prompt files do not change while the app is running. */
const cache = new Map<string, LoadedPrompt>()

function latestVersion(id: PromptId): number {
  const versions = PROMPTS[id]
  const last = versions[versions.length - 1]
  if (last === undefined) throw new UnknownPromptError(id)
  return last
}

export function isPromptId(value: string): value is PromptId {
  return Object.hasOwn(PROMPTS, value)
}

/**
 * One prompt file, parsed.
 *
 * The frontmatter's `id` and `version` are checked against the path the file was found at,
 * because they are two statements of the same fact and the one that ends up in a manifest is
 * the frontmatter's. A file copied to start a new version and not re-stamped would otherwise
 * report itself as its ancestor, and the idempotency key would reuse the ancestor's answers.
 */
export function loadPrompt(id: PromptId, version?: number): LoadedPrompt {
  if (!isPromptId(id)) throw new UnknownPromptError(id)

  const wanted = version ?? latestVersion(id)
  if (!(PROMPTS[id] as readonly number[]).includes(wanted)) {
    throw new UnknownPromptError(id, wanted)
  }

  const key = `${id}@${wanted}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const file = `prompts/${id}/${wanted}.md`
  const parsed = parsePromptFile(
    readFileSync(join(PROMPTS_ROOT, id, `${wanted}.md`), 'utf-8'),
    file,
  )

  if (parsed.frontmatter.id !== id) {
    throw new UnknownPromptError(`${id} (the file declares id "${parsed.frontmatter.id}")`, wanted)
  }
  if (parsed.frontmatter.version !== wanted) {
    throw new UnknownPromptError(
      `${id} (the file declares version ${parsed.frontmatter.version})`,
      wanted,
    )
  }

  const loaded: LoadedPrompt = {
    id,
    template: parsed.body,
    frontmatter: parsed.frontmatter,
    promptVersion: String(wanted),
  }
  cache.set(key, loaded)
  return loaded
}

/**
 * A prompt, rendered against its variables, with the versions the call has to record.
 *
 * The two versions travel together with the text because they are needed together: they are
 * `ai_calls.prompt_version` and `ai_calls.schema_version`, and they are the third and fourth
 * fields of `custom_id`. Returning the string alone would leave every call site to look them
 * up again, and the ones that forgot would silently share a cache entry across a rewrite.
 */
export function renderPrompt(
  id: PromptId,
  variables: TemplateScope = {},
  version?: number,
): RenderedPrompt {
  const prompt = loadPrompt(id, version)
  return {
    text: renderTemplate(prompt.template, variables, `${id}@${prompt.promptVersion}`),
    promptVersion: prompt.promptVersion,
    schemaVersion: prompt.frontmatter.schema,
    frontmatter: prompt.frontmatter,
  }
}

/**
 * `prompt_versions` for `GenerationManifest.v1` (`docs/spec/04-path-generation.md` §8).
 *
 * Every registered prompt at its default version, so a path records what it was built with
 * even for the prompts a particular run happened not to reach — the manifest's job is to make
 * a run reproducible, and "which prompts existed" is part of that.
 */
export function promptVersionSnapshot(): Record<PromptId, string> {
  const out = {} as Record<PromptId, string>
  for (const id of PROMPT_IDS) out[id] = String(latestVersion(id))
  return out
}
