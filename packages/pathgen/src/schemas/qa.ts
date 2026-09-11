import { z } from 'zod'

/**
 * The three output contracts of stage 8 (`docs/spec/04-path-generation.md` §5, §9): what
 * P6, P7 and P8 return. The `schema:` line of each prompt file names one of these, and it
 * is the `schemaVersion` half of every QA `custom_id`.
 *
 * Strict-mode safe like `lesson.ts`: flat objects, enums rather than unions, no recursion,
 * `nullable` rather than `optional`.
 */

// --- P6_faithfulness ------------------------------------------------------------------

export const FAITHFULNESS_SCHEMA_NAME = 'faithfulness'
export const FAITHFULNESS_SCHEMA_VERSION = '1'
export const FAITHFULNESS_SCHEMA_ID = `${FAITHFULNESS_SCHEMA_NAME}@${FAITHFULNESS_SCHEMA_VERSION}`

/** §9: "supported / not supported / contradicts, with a citation". */
export const CLAIM_VERDICTS = ['supported', 'unsupported', 'contradicts'] as const
export type ClaimVerdict = (typeof CLAIM_VERDICTS)[number]

export const claimVerdictSchema = z.object({
  /** The claim id as the task numbered it: `c01`, `c02`, … */
  id: z.string().min(1).max(16),
  verdict: z.enum(CLAIM_VERDICTS),
  /** The cite id that settles the verdict, or `null` when none of the cited fragments is relevant. */
  citation_id: z.string().max(64).nullable(),
  /** §7 multi-source: the claim cites two sources and they disagree on the point it makes. */
  sources_differ: z.boolean(),
  differing_citation_ids: z.array(z.string().min(1).max(64)).max(12),
  note: z.string().max(300),
})
export type ClaimVerdictEntry = z.infer<typeof claimVerdictSchema>

export const faithfulnessOutputSchema = z.object({
  claims: z.array(claimVerdictSchema).max(200),
})
export type FaithfulnessOutput = z.infer<typeof faithfulnessOutputSchema>

// --- P7_pedagogy_judge ----------------------------------------------------------------

export const PEDAGOGY_JUDGE_SCHEMA_NAME = 'pedagogy_judge'
export const PEDAGOGY_JUDGE_SCHEMA_VERSION = '1'
export const PEDAGOGY_JUDGE_SCHEMA_ID = `${PEDAGOGY_JUDGE_SCHEMA_NAME}@${PEDAGOGY_JUDGE_SCHEMA_VERSION}`

/** The five criteria of §5 gate 9, in the order the prompt anchors them. */
export const JUDGE_CRITERIA = [
  'clarity',
  'examples_correct',
  'cognitive_load',
  'alignment',
  'misconceptions',
] as const
export type JudgeCriterion = (typeof JUDGE_CRITERIA)[number]

export const EDIT_KINDS = ['replace', 'insert_after', 'delete'] as const
export type EditKind = (typeof EDIT_KINDS)[number]

export const MAX_JUDGE_EDITS = 12

export const judgeCriterionSchema = z.object({
  id: z.enum(JUDGE_CRITERIA),
  /** 1–5 against the prompt's anchors. */
  score: z.number().int().min(1).max(5),
  rationale: z.string().max(300),
})

export const judgeEditSchema = z.object({
  block_index: z.number().int().min(0).max(200),
  kind: z.enum(EDIT_KINDS),
  instruction: z.string().min(1).max(500),
  /** The new text for `replace` / `insert_after`; `null` for `delete`. */
  replacement: z.string().max(6_000).nullable(),
})
export type JudgeEdit = z.infer<typeof judgeEditSchema>

export const pedagogyJudgeOutputSchema = z.object({
  criteria: z.array(judgeCriterionSchema).min(1).max(5),
  overall: z.number().int().min(1).max(5),
  edits: z.array(judgeEditSchema).max(MAX_JUDGE_EDITS),
})
export type PedagogyJudgeOutput = z.infer<typeof pedagogyJudgeOutputSchema>

// --- P8_edit --------------------------------------------------------------------------

export const EDIT_LESSON_SCHEMA_NAME = 'edit_lesson'
export const EDIT_LESSON_SCHEMA_VERSION = '1'
export const EDIT_LESSON_SCHEMA_ID = `${EDIT_LESSON_SCHEMA_NAME}@${EDIT_LESSON_SCHEMA_VERSION}`

export const editChangeSchema = z.object({
  block_index: z.number().int().min(0).max(200),
  kind: z.enum(EDIT_KINDS),
  /** The block's whole new text; the inserted block's text; empty for `delete`. */
  content: z.string().max(6_000),
})
export type EditChange = z.infer<typeof editChangeSchema>

export const editLessonOutputSchema = z.object({
  changes: z.array(editChangeSchema).max(24),
  /** Edits the model could not apply without touching a citation, and why. */
  notes: z.array(z.string().max(300)).max(8),
})
export type EditLessonOutput = z.infer<typeof editLessonOutputSchema>
