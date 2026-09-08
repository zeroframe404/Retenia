/**
 * The smallest template engine that renders the prompt files, and nothing more.
 *
 * Two constructs, `{{var}}` and `{{#each list}}…{{/each}}`, because those are what the
 * prompts of `docs/spec/04-path-generation.md` §9 actually need: substitute a value, and walk
 * a list of chunks, criteria or key points. Handlebars would do it too, at the cost of a
 * dependency whose feature surface — helpers, partials, `{{{triple}}}` raw output,
 * subexpression evaluation — is all attack surface in a file that a later sub-phase may well
 * let a user edit.
 *
 * Three rules the engine enforces rather than assumes:
 *
 * - **A missing variable throws.** The alternative is a prompt that silently ships to a
 *   provider with an empty rubric in it, which reads as "no criteria" and grades accordingly.
 *   `docs/spec/01-decisions.md` §7 rule 7 applies to our own templating too.
 * - **Nothing is HTML-escaped**, because nothing here is HTML. Untrusted values are the
 *   caller's responsibility and have their own control: `wrapUserContent` puts them in a
 *   `<user_content>` block. A template cannot tell which of its variables came from a book.
 * - **No expression evaluation.** A path is a sequence of property names; there is no way to
 *   call anything from a template, which is what keeps a prompt file data rather than code.
 */

export class MissingPromptVariableError extends Error {
  override readonly name = 'MissingPromptVariableError'
  constructor(
    readonly path: string,
    templateId: string,
  ) {
    super(`the "${templateId}" prompt uses {{${path}}}, and no such value was given`)
  }
}

export class PromptTemplateError extends Error {
  override readonly name = 'PromptTemplateError'
  constructor(message: string, templateId: string) {
    super(`the "${templateId}" prompt template is malformed: ${message}`)
  }
}

export type TemplateScope = Record<string, unknown>

/** `{{@index}}` inside an `{{#each}}`, 1-based, because prompts number things for humans. */
const INDEX_KEY = '@index'
/** `{{this}}` and `{{this.field}}`: the current item of the innermost `{{#each}}`. */
const THIS_KEY = 'this'

/** `{{#each x}}`, `{{/each}}` or `{{path}}`. Whitespace inside the braces is ignored. */
const TOKEN = /\{\{\s*(#each\s+[^}]*?|\/each|[^#/}][^}]*?)\s*\}\}/g

interface Frame {
  readonly scope: TemplateScope
  readonly parent: Frame | undefined
}

/**
 * A dotted path, resolved against the innermost scope that declares its head.
 *
 * Shadowing is by *head segment*, not by full path: inside `{{#each criteria}}`, `{{id}}` is
 * the criterion's id even when the outer scope also has an `id`, which is the behaviour anyone
 * writing the template expects. A path whose head is nowhere is a missing variable; a path
 * whose head exists but whose tail does not is also missing, rather than silently empty —
 * `{{rubric.weight}}` against a rubric with no weight is a bug in one of the two.
 */
function lookup(frame: Frame | undefined, path: string): { found: boolean; value: unknown } {
  if (frame === undefined) return { found: false, value: undefined }

  const segments = path.split('.')
  const head = segments[0]
  if (head === undefined || head === '') return { found: false, value: undefined }
  if (!(head in frame.scope)) return lookup(frame.parent, path)

  let value: unknown = frame.scope[head]
  for (const segment of segments.slice(1)) {
    if (value === null || typeof value !== 'object') return { found: false, value: undefined }
    const record = value as Record<string, unknown>
    if (!(segment in record)) return { found: false, value: undefined }
    value = record[segment]
  }
  return { found: true, value }
}

/**
 * How a value reads once substituted.
 *
 * `null` and `undefined` render as an empty string rather than as the words "null" and
 * "undefined", which a model reads as content. Objects and arrays become indented JSON,
 * because a prompt that interpolates one wants to show it and `[object Object]` shows nothing.
 */
function render(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2)
}

/** What `{{#each}}` walks. A single value iterates once; nothing iterates zero times. */
function iterable(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === null || value === undefined || value === false) return []
  return [value]
}

/**
 * The body of one `{{#each}}`, and where its `{{/each}}` ended.
 *
 * Found by counting nested `{{#each}}` tokens rather than by a non-greedy match, so a list of
 * lessons each holding a list of objectives nests correctly instead of closing the outer block
 * on the inner block's `{{/each}}`.
 */
function matchEach(
  template: string,
  bodyStart: number,
  templateId: string,
): { body: string; end: number } {
  const scanner = new RegExp(TOKEN.source, 'g')
  scanner.lastIndex = bodyStart
  let depth = 1

  for (;;) {
    const match = scanner.exec(template)
    if (match === null) throw new PromptTemplateError('an {{#each}} is never closed', templateId)
    const token = match[1]
    if (token === undefined) continue
    if (token.startsWith('#each')) depth += 1
    else if (token === '/each') {
      depth -= 1
      if (depth === 0) {
        return { body: template.slice(bodyStart, match.index), end: match.index + match[0].length }
      }
    }
  }
}

function renderFrame(template: string, frame: Frame, templateId: string): string {
  const scanner = new RegExp(TOKEN.source, 'g')
  let out = ''
  let cursor = 0

  for (;;) {
    scanner.lastIndex = cursor
    const match = scanner.exec(template)
    if (match === null) return out + template.slice(cursor)

    const token = match[1]
    if (token === undefined) continue
    out += template.slice(cursor, match.index)

    if (token === '/each') throw new PromptTemplateError('an unmatched {{/each}}', templateId)

    if (token.startsWith('#each')) {
      const path = token.slice('#each'.length).trim()
      if (path === '') throw new PromptTemplateError('an {{#each}} with no list', templateId)

      const { body, end } = matchEach(template, match.index + match[0].length, templateId)
      // An empty list skips the body entirely rather than rendering it against an empty
      // scope: the body is full of `{{this.…}}` that would then be "missing variables", and
      // "there are no key points" is a legitimate state, not a template bug.
      for (const [index, item] of iterable(lookup(frame, path).value).entries()) {
        const scope: TemplateScope =
          item !== null && typeof item === 'object' && !Array.isArray(item)
            ? { ...(item as TemplateScope) }
            : {}
        scope[THIS_KEY] = item
        scope[INDEX_KEY] = index + 1
        out += renderFrame(body, { scope, parent: frame }, templateId)
      }

      cursor = end
      continue
    }

    const { found, value } = lookup(frame, token)
    if (!found) throw new MissingPromptVariableError(token, templateId)
    out += render(value)
    cursor = match.index + match[0].length
  }
}

/**
 * Render a template against a scope.
 *
 * `templateId` appears in every error, because a `{{rubric}}` that nobody passed is only
 * findable if the message says which of the prompt files wanted it.
 */
export function renderTemplate(
  template: string,
  scope: TemplateScope,
  templateId = 'inline',
): string {
  return renderFrame(template, { scope, parent: undefined }, templateId)
}
