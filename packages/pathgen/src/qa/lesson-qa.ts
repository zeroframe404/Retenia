import { z } from 'zod'
import { JUDGE_CRITERIA } from '../schemas/qa'
import { generationWarningSchema } from '../schemas/warnings'

/**
 * `LessonQa.v1` — what `lessons.qa` stores (`docs/spec/04-path-generation.md` §8:
 * `qa: { faithfulness, pedagogy_score, coverage_ok, warnings[] }`, sub-phase 8.4).
 *
 * §8's four keys come first and mean exactly what the spec says. The rest is what the QA
 * report and the badges need and the four cannot carry: which gate said what, the flagged
 * sentences with their citations (so a click can open the source), the two iteration
 * counters §5 caps at one each, what the pass cost, and which models judged — because a
 * judge's verdict is only meaningful next to the name of the model that gave it.
 *
 * Written **once, at the verdict**, together with the edited theory and the upgraded
 * citations (`persist.ts`). A row never carries a half-finished QA: a crash mid-pass leaves
 * the lesson in status `qa` with its pre-QA theory, and the resume runs the gates again over
 * answers `ai_results` already holds.
 */

export const LESSON_QA_VERSION = 1

/** §5's ten gates, by the letter the sub-phase prompt gave them. */
export const QA_GATES = [
  'schema',
  'citations',
  'faithfulness',
  'coverage',
  'duplicates',
  'variety',
  'length',
  'language',
  'judge',
  'edit',
] as const
export type QaGate = (typeof QA_GATES)[number]

export const QA_GATE_OUTCOMES = ['pass', 'fix', 'regenerate', 'skipped'] as const
export type QaGateOutcome = (typeof QA_GATE_OUTCOMES)[number]

/**
 * How the lesson left the gates. `pass` needed nothing; `fixed` went through P8 once;
 * `regenerated` is a second P3 that then passed; `flagged` is what the user has to look at —
 * below a threshold after the one regeneration §5 allows, or a gate that could not run.
 */
export const QA_VERDICTS = ['pass', 'fixed', 'regenerated', 'flagged'] as const
export type QaVerdict = (typeof QA_VERDICTS)[number]

/** "QA ligera": gates (a)–(h) only, no judge and no editor, to save the two mid-tier calls. */
export const QA_MODES = ['full', 'light'] as const
export type QaMode = (typeof QA_MODES)[number]

export const QA_FINDING_KINDS = [
  'citation_missing',
  'citation_span_mismatch',
  'claim_unsupported',
  'claim_contradicts',
  'sources_differ',
  'concept_uncovered',
  'activity_duplicate',
  'flashcard_duplicate',
  'variety_rule',
  'module_bloom_variety',
  'theory_length',
  'language_mismatch',
  'glossary_term_mixed',
  'judge_edit',
  'edit_rejected',
] as const
export type QaFindingKind = (typeof QA_FINDING_KINDS)[number]

export const MAX_FINDING_SENTENCE_CHARS = 300
export const MAX_FINDINGS = 50

/** One flagged thing, with enough to render it and to open the source it cites. */
export const qaFindingSchema = z.object({
  gate: z.enum(QA_GATES),
  kind: z.enum(QA_FINDING_KINDS),
  /** The theory block it is about, when it is about one. */
  block_index: z.number().int().min(0).nullable(),
  sentence: z.string().max(MAX_FINDING_SENTENCE_CHARS),
  citation_ids: z.array(z.string()),
  detail: z.string().max(MAX_FINDING_SENTENCE_CHARS),
})
export type QaFinding = z.infer<typeof qaFindingSchema>

export const lessonQaSchema = z.object({
  // §8's four keys.
  /** supported ÷ evaluated claims; `null` when the lesson made no cited claim. */
  faithfulness: z.number().min(0).max(1).nullable(),
  /** The mean of the judge's five criteria; `null` in light mode or when the judge did not run. */
  pedagogy_score: z.number().min(1).max(5).nullable(),
  coverage_ok: z.boolean(),
  warnings: z.array(generationWarningSchema),

  version: z.literal(LESSON_QA_VERSION),
  run_id: z.string(),
  at: z.string(),
  mode: z.enum(QA_MODES),
  verdict: z.enum(QA_VERDICTS),
  /** Every gate ran to a conclusion — the badge's "revisado". A `flagged` lesson is still reviewed. */
  reviewed: z.boolean(),
  /** Distinct sources the lesson cites — the "sources count" badge. */
  sources_count: z.number().int().min(0),
  /** §5 gate 10: at most one edit pass; the sub-phase's acceptance: at most one regeneration. */
  iterations: z.object({
    edit: z.number().int().min(0).max(1),
    regenerate: z.number().int().min(0).max(1),
  }),
  gates: z.array(z.object({ gate: z.enum(QA_GATES), outcome: z.enum(QA_GATE_OUTCOMES) })),
  criteria: z.array(z.object({ id: z.enum(JUDGE_CRITERIA), score: z.number().int() })),
  findings: z.array(qaFindingSchema).max(MAX_FINDINGS),
  cost: z.object({
    usd: z.number().min(0),
    calls: z.number().int().min(0),
    cache_hits: z.number().int().min(0),
  }),
  models: z.object({
    p6: z.string().nullable(),
    p7: z.string().nullable(),
    p8: z.string().nullable(),
  }),
})
export type LessonQa = z.infer<typeof lessonQaSchema>

/**
 * The stored record, or `null`.
 *
 * Tolerant the way `readExpansion` is: a `qa` blob that does not parse reads as "not
 * reviewed" rather than failing the panel or the report for every lesson of the path.
 */
export function readLessonQa(value: unknown): LessonQa | null {
  const parsed = lessonQaSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** What crosses the IPC boundary for a badge: `LessonQaSummaryDto` mirrors it. */
export interface LessonQaSummary {
  readonly faithfulness: number | null
  readonly pedagogyScore: number | null
  readonly coverageOk: boolean
  readonly verdict: QaVerdict
  readonly reviewed: boolean
  readonly sourcesCount: number
  readonly findings: number
}

export function summarizeQa(qa: LessonQa): LessonQaSummary {
  return {
    faithfulness: qa.faithfulness,
    pedagogyScore: qa.pedagogy_score,
    coverageOk: qa.coverage_ok,
    verdict: qa.verdict,
    reviewed: qa.reviewed,
    sourcesCount: qa.sources_count,
    findings: qa.findings.length,
  }
}
