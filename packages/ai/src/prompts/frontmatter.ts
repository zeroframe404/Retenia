import { z } from 'zod'
import type { ProviderRole } from '../provider-port'

/**
 * The header of a prompt file, and the reason it is a header rather than a TypeScript object.
 *
 * A prompt is content: it is reviewed like prose, its diffs are read like prose, and it is the
 * artefact a non-programmer can reasonably be asked to improve. Keeping the version, the role
 * and the temperature *inside* the file is what makes those facts move with the wording —
 * `docs/spec/04-path-generation.md` §7 requires a manifest recording "prompt and schema
 * versions… temperature" per generated path, and a version restated in code would go on
 * saying `1` after somebody rewrote the file.
 *
 * The dialect is a deliberate subset of YAML: `key: value` at the top level, `>-` folded
 * blocks for prose, `#` comments, nothing else. Enough for the eleven fields these files use,
 * and small enough not to want a YAML parser — which would bring anchors, merge keys,
 * arbitrary types and the whole class of surprises that come with them, for a file we may one
 * day let a user edit.
 */

/** The `---` … `---` block, and everything after it. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export class PromptFrontmatterError extends Error {
  override readonly name = 'PromptFrontmatterError'
  constructor(message: string, file: string) {
    super(`the prompt file "${file}" ${message}`)
  }
}

/**
 * What every registered prompt declares.
 *
 * `role` is a `ProviderRole` and not the spec's `cheap | mid | strong` tier: the tier is a
 * recommendation about model quality, and this field has to be something `AiClient` can route
 * on. The mapping is stated in each file's `notes`, so the spec's table stays traceable.
 */
export const promptFrontmatterSchema = z.object({
  id: z.string().min(1),
  /** A positive integer, matching the file's own name (`prompts/<id>/<version>.md`). */
  version: z.coerce.number().int().positive(),
  role: z.enum(['smart', 'cheap', 'vision', 'audio', 'embed', 'local']),
  /**
   * §7: **0** in extraction, judges and grading; 0.5–0.7 in writing. Declared per prompt
   * rather than passed per call site, so that "the grader must be deterministic" is a property
   * of the grader's prompt and not of whoever remembered to pass a zero.
   */
  temperature: z.coerce.number().min(0).max(2),
  /**
   * Which output contract the completion is validated against, and its version:
   * `grade_long_text@1`, or `none` for a prompt that returns prose.
   *
   * It is the `schemaVersion` half of `custom_id`, so it is what invalidates the result cache
   * when the shape changes without the wording doing so.
   */
  schema: z.string().min(1),
  /** Free prose: what it is for, what it must not do, where it came from. */
  notes: z.string().optional(),
  /** `docs/spec/04-path-generation.md §12` — the section this prompt implements. */
  source: z.string().optional(),
  /** `P10_grade`, `P1_extract_chunk`… the name §9's table gives it, when it has one. */
  pipeline_prompt: z.string().optional(),
  /** The stage number of §3's pipeline, when the prompt belongs to one. */
  pipeline_stage: z.coerce.number().int().nonnegative().optional(),
  description: z.string().optional(),
})

export type PromptFrontmatter = z.infer<typeof promptFrontmatterSchema> & { role: ProviderRole }

export interface ParsedPromptFile {
  readonly frontmatter: PromptFrontmatter
  /** Everything after the closing `---`, with the leading blank line removed. */
  readonly body: string
}

/**
 * `key: value` pairs, plus `>-` folded blocks.
 *
 * A folded block is the one multi-line form the prompt files use, and it is the one YAML form
 * whose semantics are worth reproducing exactly: continuation lines are those indented more
 * than the key, and they join with single spaces.
 */
function parseFields(source: string, file: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = source.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) continue
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue

    const separator = line.indexOf(':')
    if (separator < 0) {
      throw new PromptFrontmatterError(
        `has a frontmatter line that is not "key: value": ${line}`,
        file,
      )
    }

    const key = line.slice(0, separator).trim()
    const raw = line.slice(separator + 1).trim()

    if (raw === '>-' || raw === '>' || raw === '|' || raw === '|-') {
      const folded: string[] = []
      while (index + 1 < lines.length) {
        const next = lines[index + 1]
        if (next === undefined) break
        if (next.trim() !== '' && !/^\s/.test(next)) break
        folded.push(next.trim())
        index += 1
      }
      // `>` folds, `|` keeps the line breaks. Both are used for prose that a model never
      // sees, so folding both would be fine — keeping the distinction costs one branch and
      // means a `|` block in a future file does what its author meant.
      out[key] = raw.startsWith('|')
        ? folded.join('\n').trim()
        : folded.join(' ').replace(/\s+/g, ' ').trim()
      continue
    }

    // Quoted scalars, because a `description: "a: b"` is otherwise ambiguous.
    out[key] =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw
  }

  return out
}

export function parsePromptFile(source: string, file: string): ParsedPromptFile {
  const match = FRONTMATTER.exec(source)
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new PromptFrontmatterError('has no --- frontmatter block', file)
  }

  const parsed = promptFrontmatterSchema.safeParse(parseFields(match[1], file))
  if (!parsed.success) {
    throw new PromptFrontmatterError(
      `has invalid frontmatter: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
      file,
    )
  }

  return { frontmatter: parsed.data as PromptFrontmatter, body: match[2].replace(/^\r?\n/, '') }
}
