import { z } from 'zod'
import { shortIdSchema } from '../common'

/** `cloze` (§7): text segments interleaved with gaps, typed, chosen from a dropdown or dragged from a bank. */

export const CLOZE_MODES = ['typed', 'dropdown', 'wordbank'] as const
export type ClozeMode = (typeof CLOZE_MODES)[number]

export const CLOZE_LAYOUTS = ['inline', 'table', 'code'] as const
export type ClozeLayout = (typeof CLOZE_LAYOUTS)[number]

export const clozeTextSegmentSchema = z.object({
  kind: z.literal('text'),
  text: z.string().min(1),
})

export const clozeGapSegmentSchema = z.object({
  kind: z.literal('gap'),
  id: shortIdSchema,
  answers: z.array(z.string().min(1)).min(1).describe('Accepted fillings; the first is canonical.'),
  options: z
    .array(z.string().min(1))
    .optional()
    .describe('Dropdown choices for this gap (must include an answer).'),
  visiblePrefix: z.string().optional().describe('Letters shown at the start of the gap (c-test).'),
})
export type ClozeGap = z.infer<typeof clozeGapSegmentSchema>

export const clozeSegmentSchema = z.discriminatedUnion('kind', [
  clozeTextSegmentSchema,
  clozeGapSegmentSchema,
])
export type ClozeSegment = z.infer<typeof clozeSegmentSchema>

export const clozePayloadSchema = z.object({
  family: z.literal('cloze'),
  mode: z.enum(CLOZE_MODES),
  layout: z.enum(CLOZE_LAYOUTS).optional(),
  segments: z.array(clozeSegmentSchema).min(1),
  bankDistractors: z
    .array(z.string().min(1))
    .optional()
    .describe('Extra words in the word bank that fill no gap.'),
  singleUseDraggables: z.boolean().optional(),
})
export type ClozePayload = z.infer<typeof clozePayloadSchema>
