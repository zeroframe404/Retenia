import { AiError } from '../errors'

/**
 * What a model returned, made safe to store and to render, **before** the schema sees it.
 *
 * Order matters and is the opposite of the obvious one. Sanitizing after validation would
 * mean the value the caller receives is not the value the schema approved: a string capped
 * from 40 000 characters to 4 000 would slip past a `.max()` the author wrote precisely to
 * stop it, and a `<script>` stripped afterwards could break a `.regex()` that had already
 * passed. Sanitizing first makes the schema the last word on the value that is actually
 * returned, which is what `docs/spec/01-decisions.md` §7 rule 7 — "the AI proposes, the
 * code validates" — is worth having.
 *
 * The threat is not a model that decides to attack us. It is a model that faithfully copies
 * what it was shown: these completions are written from the user's own PDFs, scraped web
 * pages and video transcripts, any of which can contain a `<script>` tag, and the result is
 * stored in SQLite and later rendered in a Chromium window. `docs/spec/07-architecture.md`
 * makes the renderer's CSP strict precisely so that a stored `<script>` is inert, and this
 * is the second half of that: defence in depth, not a substitute for it.
 */

export interface SanitizeLimits {
  /** Longest string kept, in UTF-16 code units. Longer ones are truncated with an ellipsis. */
  readonly maxStringChars: number
  /** Longest array kept. Extra elements are dropped, not an error — see `runStructured`. */
  readonly maxArrayItems: number
  /** How deep a value may nest before it is rejected outright. */
  readonly maxDepth: number
  /** Most keys on one object. */
  readonly maxObjectKeys: number
  /** Total characters across every string in the value. */
  readonly maxTotalChars: number
}

/**
 * Generous enough that nothing an honest prompt asks for is touched, small enough that a
 * runaway completion cannot fill a column.
 *
 * The output cap of `docs/spec/06-ai-providers.md` §6 is 128K tokens ≈ 500 KB of text, so
 * `maxTotalChars` is the real bound; the per-string cap is what keeps one field from being
 * the whole budget. A lesson's theory block is the longest legitimate string in the app at
 * ~1 200 words, and 20 000 characters is an order of magnitude above it.
 */
export const DEFAULT_SANITIZE_LIMITS: SanitizeLimits = Object.freeze({
  maxStringChars: 20_000,
  maxArrayItems: 500,
  maxDepth: 12,
  maxObjectKeys: 200,
  maxTotalChars: 600_000,
})

/**
 * The tags stripped, with their contents.
 *
 * Element-wise rather than "strip every `<…>`": the completions carry Markdown, Mermaid and
 * LaTeX, and `a < b` and `<T>` are ordinary text a blanket filter would mangle. These four
 * are the ones that execute or fetch — `script` and `iframe` are named in the sub-phase
 * brief, `object` and `embed` are the same hole with a different spelling — and there is no
 * legitimate reason for any of them to appear in a lesson, a grade or a chunk context.
 */
const EXECUTABLE_ELEMENTS = ['script', 'iframe', 'object', 'embed'] as const

/**
 * Matches an opening tag through its closing one, and also an unclosed opener.
 *
 * Case-insensitive, tolerant of attributes and of whitespace inside the tag, because the
 * point is to remove the construct rather than to parse HTML: anything left behind that
 * still *looks* like one of these tags is escaped below, so a partial match degrades to
 * visible text rather than to live markup.
 */
const ELEMENTS = EXECUTABLE_ELEMENTS.join('|')
const EXECUTABLE_PATTERN = new RegExp(
  `<\\s*(${ELEMENTS})\\b[^>]*>[\\s\\S]*?<\\s*/\\s*\\1\\s*>` +
    `|<\\s*/?\\s*(?:${ELEMENTS})\\b[^>]*>`,
  'gi',
)

/** `javascript:` and `data:text/html` hrefs, which need no tag of their own to execute. */
const DANGEROUS_URL = /\b(?:javascript|vbscript)\s*:|data\s*:\s*text\/html/gi

/** `onclick=`, `onerror=` … an attribute that survived its element being stripped. */
const EVENT_HANDLER_ATTRIBUTE = /\son[a-z]{3,20}\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi

export function sanitizeString(value: string, limits: SanitizeLimits): string {
  const stripped = value
    .replace(EXECUTABLE_PATTERN, '')
    .replace(EVENT_HANDLER_ATTRIBUTE, '')
    .replace(DANGEROUS_URL, 'blocked:')
  return stripped.length <= limits.maxStringChars
    ? stripped
    : `${stripped.slice(0, limits.maxStringChars - 1)}…`
}

/**
 * Walk the parsed completion, capping and stripping as we go.
 *
 * Rejects rather than repairs in exactly two cases — a value nested past `maxDepth`, and a
 * total size past `maxTotalChars` — because both mean the model produced something
 * structurally unlike what was asked for, and a truncated version of that is not an answer
 * anyone should act on. Everything else is repaired in place: an over-long string is the
 * model being verbose, which the schema may well still accept.
 *
 * Keys are sanitized too. A completion is `JSON.parse`d into an object we then hand to zod
 * and eventually store, and nothing stops a model from emitting a key with a tag in it.
 */
export function sanitizeOutput(
  value: unknown,
  limits: SanitizeLimits = DEFAULT_SANITIZE_LIMITS,
): unknown {
  let total = 0

  const walk = (node: unknown, depth: number): unknown => {
    if (depth > limits.maxDepth) {
      throw new AiError(
        'output_invalid',
        `the completion nests more than ${limits.maxDepth} levels deep`,
      )
    }

    if (typeof node === 'string') {
      const text = sanitizeString(node, limits)
      total += text.length
      if (total > limits.maxTotalChars) {
        throw new AiError(
          'output_invalid',
          `the completion holds more than ${limits.maxTotalChars} characters of text`,
        )
      }
      return text
    }

    // `null` is a value the schemas use (`rating: null` when a grade is uncertain); the
    // other two primitives pass through, and a non-finite number is normalised to null
    // rather than rejected, because `JSON.parse` cannot produce one anyway.
    if (node === null || typeof node === 'boolean') return node
    if (typeof node === 'number') return Number.isFinite(node) ? node : null

    if (Array.isArray(node)) {
      return node.slice(0, limits.maxArrayItems).map((entry) => walk(entry, depth + 1))
    }

    if (typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(node).slice(0, limits.maxObjectKeys)) {
        // `__proto__` and friends: `Object.entries` already skips the prototype chain, but
        // an own key literally named `__proto__` survives `JSON.parse` and would be a
        // prototype write on a plain assignment in some engines. Dropped, not renamed.
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
        out[sanitizeString(key, limits)] = walk(entry, depth + 1)
      }
      return out
    }

    // `undefined`, a function, a symbol: unreachable from `JSON.parse`, so reaching here
    // means the caller handed us something else. Dropping it is the honest answer.
    return null
  }

  return walk(value, 0)
}
