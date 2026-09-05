import { z } from 'zod'
import { COLLECTION_MAX, LABEL_MAX, PLAIN_TEXT_MAX, richTextSchema, shortIdSchema } from '../common'

/** `long_text` (§7): free production graded by key points (FUZ set-match), a rubric (AI) or the user. */

export const keyPointSchema = z.object({
  id: shortIdSchema,
  text: z.string().min(1).max(PLAIN_TEXT_MAX),
  weight: z.number().positive().optional().describe('Relative weight; default 1.'),
  aliases: z
    .array(z.string().min(1).max(LABEL_MAX))
    .max(COLLECTION_MAX)
    .optional()
    .describe('Other phrasings that count as covered.'),
})
export type KeyPoint = z.infer<typeof keyPointSchema>

export const rubricLevelSchema = z.object({
  score: z.number().min(0).max(1),
  description: z.string().min(1).max(PLAIN_TEXT_MAX),
})

export const rubricCriterionSchema = z.object({
  id: shortIdSchema,
  criterion: z.string().min(1).max(PLAIN_TEXT_MAX),
  weight: z.number().positive().optional(),
  levels: z
    .array(rubricLevelSchema)
    .min(2)
    .max(COLLECTION_MAX)
    .describe('Anchored levels, e.g. 0 / 0.5 / 1.'),
})
export type RubricCriterion = z.infer<typeof rubricCriterionSchema>

export const longTextSectionSchema = z.object({
  id: shortIdSchema,
  title: z.string().min(1).max(LABEL_MAX),
  hint: richTextSchema.optional(),
})

export const longTextPayloadSchema = z.object({
  family: z.literal('long_text'),
  minWords: z.int().min(1).optional(),
  maxWords: z.int().min(1).optional(),
  sections: z
    .array(longTextSectionSchema)
    .max(COLLECTION_MAX)
    .optional()
    .describe('Scaffold (structure_strip).'),
  modelAnswer: richTextSchema.optional(),
  keyPoints: z.array(keyPointSchema).max(COLLECTION_MAX).optional(),
  rubric: z.array(rubricCriterionSchema).max(COLLECTION_MAX).optional(),
})
export type LongTextPayload = z.infer<typeof longTextPayloadSchema>
