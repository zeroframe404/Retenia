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
 * Pulls the JSON object out of a completion.
 *
 * Providers wrap JSON in a fence or in a sentence often enough that refusing those outright
 * would burn a retry on a well-formed answer. Anything past that is a parse failure, and the
 * caller falls back rather than guessing — §8's repair loop is sub-phase 7.2's, not this one's.
 */
export function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = (fenced?.[1] ?? text).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new SyntaxError('grade_long_text: the completion contained no JSON object')
  }
  return JSON.parse(candidate.slice(start, end + 1))
}

export function parseGradeLongTextOutput(text: string): GradeLongTextOutput {
  return gradeLongTextOutputSchema.parse(extractJsonObject(text))
}
