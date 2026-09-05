import { z } from 'zod'
import { COLLECTION_MAX, LABEL_MAX, PLAIN_TEXT_MAX, richTextSchema } from '../common'

/** `text_input` (§7): one typed value, graded as text (FUZ), number, letters, regex or math. */

export const INPUT_KINDS = ['text', 'number', 'math', 'letters', 'regex'] as const
export type InputKind = (typeof INPUT_KINDS)[number]

export const textAnswerSchema = z.object({
  value: z.string().min(1).max(PLAIN_TEXT_MAX),
  isRegex: z.boolean().optional().describe('value is an anchored regular expression.'),
  feedback: richTextSchema.optional(),
})
export type TextAnswer = z.infer<typeof textAnswerSchema>

export const numericExpectationSchema = z.object({
  value: z.number(),
  tol: z
    .object({
      abs: z.number().min(0).optional(),
      rel: z.number().min(0).optional(),
    })
    .optional()
    .describe('Overrides grading.numeric for this activity.'),
  unit: z
    .string()
    .min(1)
    .max(LABEL_MAX)
    .optional()
    .describe('Expected unit, e.g. km; converted when known.'),
})
export type NumericExpectation = z.infer<typeof numericExpectationSchema>

export const regexCaseSchema = z.object({
  input: z.string().max(LABEL_MAX),
  shouldMatch: z.boolean(),
})

export const textInputPayloadSchema = z.object({
  family: z.literal('text_input'),
  inputKind: z.enum(INPUT_KINDS),
  answers: z
    .array(textAnswerSchema)
    .min(1)
    .max(COLLECTION_MAX)
    .describe('Accepted answers; the first is shown as the model answer.'),
  numeric: numericExpectationSchema.optional(),
  regexCases: z
    .array(regexCaseSchema)
    .max(COLLECTION_MAX)
    .optional()
    .describe("For inputKind regex: strings the user's pattern must and must not match."),
})
export type TextInputPayload = z.infer<typeof textInputPayloadSchema>
