import type { z } from 'zod'
import { AiError } from '../errors'

/**
 * Getting a value out of a completion, and saying usefully what is wrong when there is not
 * one.
 *
 * Every message built here is fed back to the model by the repair loop, so it is written
 * for a reader who has just produced the broken output and has to fix it — paths, expected
 * types, nothing about our internals — and it is deliberately short: the repair turn pays
 * for the original prompt again, and a 4 KB list of every issue in a 200-item array costs
 * more than it buys.
 */

/** Longest completion this will try to find JSON inside. Past it, the answer is not JSON. */
export const MAX_COMPLETION_CHARS = 4_000_000

/** How many zod issues are quoted back. Beyond this the model has misunderstood the shape. */
export const MAX_REPORTED_ISSUES = 12

const FENCE = /^\s*```(?:json|jsonc|json5)?\s*\r?\n([\s\S]*?)\r?\n?\s*```\s*$/i

/**
 * The JSON inside whatever the model actually said.
 *
 * Three layers, cheapest first: the whole string, the contents of a single code fence, and
 * finally the first balanced `{…}` or `[…]` in the text. The third exists because a model
 * that was asked for JSON and answered "Sure! Here it is: {…}" has produced a usable answer,
 * and burning a repair turn on the preamble is money for nothing — but it is a *scan*, not a
 * parser: the balance counter honours string literals and escapes so a `}` inside a quoted
 * value does not close the object early.
 */
export function extractJsonText(completion: string): string | undefined {
  const text = completion.trim()
  if (text === '' || text.length > MAX_COMPLETION_CHARS) return undefined
  if (text.startsWith('{') || text.startsWith('[')) return text

  const fenced = FENCE.exec(text)
  if (fenced?.[1] !== undefined) return fenced[1].trim()

  const start = text.search(/[[{]/)
  if (start < 0) return undefined

  const opener = text[start]
  const closer = opener === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === opener) depth += 1
    else if (character === closer) {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return undefined
}

export function parseJsonCompletion(completion: string): unknown {
  const text = extractJsonText(completion)
  if (text === undefined) {
    throw new AiError('output_invalid', 'the completion contains no JSON value')
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new AiError(
      'output_invalid',
      `the completion is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** `perCriterion[2].score` — the path a model can find in its own output. */
function pathOf(issue: z.core.$ZodIssue): string {
  if (issue.path.length === 0) return '(the whole object)'
  return issue.path.reduce<string>((accumulated, segment) => {
    if (typeof segment === 'number') return `${accumulated}[${segment}]`
    return accumulated === '' ? String(segment) : `${accumulated}.${String(segment)}`
  }, '')
}

/**
 * The zod failure, as a list the model can act on.
 *
 * Issues are deduplicated by path: an array whose every element is missing the same field
 * produces one issue per element, and repeating "items[0].id is required … items[199].id is
 * required" is 200 lines saying one thing.
 */
export function describeIssues(error: z.ZodError): string[] {
  const seen = new Map<string, string>()
  for (const issue of error.issues) {
    const path = pathOf(issue)
    // Only the first `[n]` is kept, so the whole array collapses to one line.
    const key = `${path.replace(/\[\d+\]/g, '[]')}|${issue.code}`
    if (seen.has(key)) continue
    seen.set(key, `${path}: ${issue.message}`)
    if (seen.size >= MAX_REPORTED_ISSUES) break
  }
  return [...seen.values()]
}

/**
 * The repair turn (`docs/spec/06-ai-providers.md` §6: "uniform validation and repair with
 * Zod").
 *
 * The broken output is quoted back rather than described, because a model asked to "fix the
 * score field" with no sight of what it wrote regenerates the whole answer from scratch —
 * which is a second full-price call that is as likely to fail the same way. It is quoted
 * *truncated*: past a few thousand characters the useful signal is the issue list, and the
 * whole point of a repair turn is that it is cheaper than the original.
 *
 * It says "fix only these fields" for a reason beyond cost. A repair that rewrites the whole
 * answer can quietly change a grade or drop a citation that had already passed QA; the
 * narrow instruction keeps the repair a repair.
 */
export const MAX_QUOTED_OUTPUT_CHARS = 8_000

export function buildRepairPrompt(previous: string, issues: readonly string[]): string {
  const quoted =
    previous.length <= MAX_QUOTED_OUTPUT_CHARS
      ? previous
      : `${previous.slice(0, MAX_QUOTED_OUTPUT_CHARS)}\n…(truncated)`

  return [
    'Your previous answer did not match the required schema.',
    '',
    'This is what you returned:',
    '',
    quoted,
    '',
    'These are the problems with it:',
    '',
    ...issues.map((issue) => `- ${issue}`),
    '',
    'Return the corrected JSON value. Fix only these fields — keep every other value exactly',
    'as it was, do not re-answer the question, and do not add commentary, explanation or a',
    'code fence. Output the JSON and nothing else.',
  ].join('\n')
}
