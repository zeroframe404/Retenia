import { z } from 'zod'

/**
 * The structured output of `prompts/grade_long_text.md` (P10 of
 * `docs/spec/04-path-generation.md` §9), as both a zod parser and the JSON Schema handed to the
 * provider.
 *
 * `GRADE_LONG_TEXT_JSON_SCHEMA` is written out by hand rather than derived from the zod schema
 * because §8 constrains what Claude's strict mode accepts: no `minimum`/`maximum`, no `pattern`,
 * no recursive references — the constraints travel in `description` instead. A test asserts it
 * is byte-identical to the fenced schema inside the prompt file, so the two cannot drift.
 */

export const gradeCriterionOutputSchema = z.object({
  id: z.string().min(1),
  score: z.number(),
  level: z.string().min(1).optional(),
  comment: z.string().min(1).optional(),
})

export const gradeLongTextOutputSchema = z.object({
  perCriterion: z.array(gradeCriterionOutputSchema),
  score: z.number(),
  rating: z.union([z.literal([1, 2, 3, 4]), z.null()]),
  feedback: z.string().min(1),
  uncertain: z.boolean(),
  evidence: z.array(
    z.object({ quote: z.string().min(1), criterionId: z.string().min(1).optional() }),
  ),
})
export type GradeLongTextOutput = z.infer<typeof gradeLongTextOutputSchema>

export const GRADE_LONG_TEXT_SCHEMA_NAME = 'grade_long_text'

export const GRADE_LONG_TEXT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['perCriterion', 'score', 'rating', 'feedback', 'uncertain', 'evidence'],
  properties: {
    perCriterion: {
      type: 'array',
      description: 'One entry per rubric criterion, in the order the rubric lists them.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'score'],
        properties: {
          id: { type: 'string', description: "The criterion's id, copied verbatim." },
          score: { type: 'number', description: "The chosen anchor's score, 0 to 1." },
          level: { type: 'string', description: "The chosen anchor's description." },
          comment: { type: 'string', description: 'One short line on why this anchor.' },
        },
      },
    },
    score: {
      type: 'number',
      description:
        'Weighted mean of perCriterion in [0,1]; the key-point coverage when there is no rubric.',
    },
    rating: {
      type: ['integer', 'null'],
      description: '1 Again, 2 Hard, 3 Good, 4 Easy, or null when uncertain.',
    },
    feedback: {
      type: 'string',
      description: "Two or three lines for the learner, in the answer's language.",
    },
    uncertain: {
      type: 'boolean',
      description: 'True only when the answer genuinely cannot be graded from the material.',
    },
    evidence: {
      type: 'array',
      description: "Quotes taken verbatim from the learner's answer.",
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['quote'],
        properties: {
          quote: { type: 'string' },
          criterionId: { type: 'string' },
        },
      },
    },
  },
} as const

/**
 * Every balanced top-level `{…}` span in the text, in the order they appear.
 *
 * Brace-aware rather than "first `{` to last `}`", which swallows two adjacent objects into one
 * unparseable blob — exactly what happens when a model quotes the learner's JSON and then adds
 * its own. String literals and their escapes are tracked so a `}` inside a feedback line does
 * not close anything.
 */
function balancedObjects(text: string): string[] {
  const spans: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') {
      if (depth === 0) start = i
      depth++
    } else if (char === '}' && depth > 0) {
      depth--
      if (depth === 0 && start !== -1) {
        spans.push(text.slice(start, i + 1))
        start = -1
      }
    }
  }
  return spans
}

/**
 * Pulls the JSON object out of a completion.
 *
 * Candidates in decreasing order of trust: the whole completion (what the prompt asks for and
 * what a provider enforcing `jsonSchema` returns), then each fenced block from **last** to
 * first, then each balanced `{…}` span from last to first.
 *
 * "Last", not first, because the first object in a completion is not necessarily the model's:
 * a learner can write their answer *as* a ```json fence containing a schema-valid grade and ask
 * the model to open its reply by quoting them. Taking the first would then parse the learner's
 * own object. Preferring the last, and skipping any candidate that appears verbatim inside the
 * answer, closes that: a planted object is quoted material, and quoted material is never the
 * grade. When nothing survives, the caller falls back to the deterministic estimate — which is
 * the right outcome, and never the learner's own marks.
 */
export function extractJsonObject(text: string, answer?: string): unknown {
  const candidates: string[] = []
  const whole = text.trim()
  if (whole.startsWith('{')) candidates.push(whole)

  for (const fence of [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].reverse()) {
    const body = fence[1]?.trim()
    if (body !== undefined && body !== '') candidates.push(body)
  }
  candidates.push(...balancedObjects(text).reverse())

  for (const candidate of candidates) {
    // A candidate the learner wrote is not a grade, however well-formed it is.
    if (answer?.includes(candidate)) continue
    try {
      return JSON.parse(candidate)
    } catch {
      // Try the next, less trustworthy, shape.
    }
  }
  throw new SyntaxError('grade_long_text: the completion contained no usable JSON object')
}

export function parseGradeLongTextOutput(text: string, answer?: string): GradeLongTextOutput {
  return gradeLongTextOutputSchema.parse(extractJsonObject(text, answer))
}
