import { z } from 'zod'
import { defineContract } from '../define'

/**
 * "Generate with AI": the wizard's live estimate, starting/resuming/cancelling a generation
 * run, the editable preview's draft-edit ops, and freezing a version
 * (`docs/spec/04-path-generation.md` §13 steps 1–3 and 6; sub-phase 8.2).
 *
 * Every enum and node shape here mirrors `@retenia/pathgen`'s own zod schemas rather than
 * importing them: this package is a leaf by architectural rule
 * (`tooling/scripts/check-deps.mjs` pins `ipc-contract: []`), so it cannot depend on
 * `@retenia/pathgen`. `pathgen.test.ts` asserts the enum lists still agree. A few leaf fields
 * inside the draft (bloom level, warning code/stage) are intentionally looser than pathgen's
 * own schema — main has already validated the real thing with `pathDraftSchema.parse` before
 * this DTO ever crosses the bridge, so the DTO's job is bounding what the renderer receives,
 * not re-deriving pathgen's full vocabulary a third time.
 */

/** Mirrors `GENERATION_RUN_STATUSES` in `packages/db/src/schema/generation.ts`. */
export const GENERATION_RUN_STATUSES = [
  'queued',
  'extracting',
  'consolidating',
  'synthesizing',
  'sequencing',
  'persisting',
  'expanding',
  'completed',
  'failed',
  'cancelled',
  'blocked_budget',
] as const
export const generationRunStatusSchema = z.enum(GENERATION_RUN_STATUSES)
export type GenerationRunStatusDto = z.infer<typeof generationRunStatusSchema>

/** Mirrors `GENERATION_STAGES` in `packages/pathgen/src/progress/stages.ts`. */
export const GENERATION_STAGES = [
  'reading_sources',
  'extracting',
  'consolidating',
  'synthesizing',
  'synthesizing_modules',
  'sequencing',
  'persisting',
  'expanding_theory',
  'expanding_practice',
  'expanding_flashcards',
  'qa_faithfulness',
  'qa_judge',
  'qa_edit',
] as const
export const generationStageSchema = z.enum(GENERATION_STAGES)

/** Mirrors `QA_MODES` in `packages/pathgen/src/qa/lesson-qa.ts` (sub-phase 8.4). */
export const QA_MODES = ['full', 'light'] as const
export const qaModeSchema = z.enum(QA_MODES)
export type QaModeDto = z.infer<typeof qaModeSchema>
export type GenerationStageDto = z.infer<typeof generationStageSchema>

const HEADING_PATH_SEPARATOR_LEN = 500
const isoDate = z.iso.date()
const bcp47 = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)

/** Mirrors `generationScopeSchema` in `packages/pathgen/src/config/generation-config.ts`. */
export const generationScopeDtoSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({
    kind: z.literal('selected'),
    headingPaths: z.array(z.string().trim().min(1).max(HEADING_PATH_SEPARATOR_LEN)).min(1).max(200),
  }),
])
export type GenerationScopeDto = z.infer<typeof generationScopeDtoSchema>

/**
 * Mirrors `generationConfigSchema` in `packages/pathgen/src/config/generation-config.ts` —
 * the wizard's template fields (§13 step 1) — superRefine included, so a malformed config is
 * rejected at the bridge rather than surfacing as an opaque `GenerationError` from main.
 */
export const generationConfigInputSchema = z
  .object({
    goal: z.string().trim().min(1).max(500),
    level: z.string().trim().min(1).max(60),
    lessonLanguage: bcp47.optional(),
    /** Set only for a path that *teaches* a language; `null`/absent for every other path. */
    targetLanguage: bcp47.nullable().optional(),
    forExam: z.object({ date: isoDate }).nullable().optional(),
    paceHoursPerWeek: z.number().min(0.5).max(60).optional(),
    primarySourceId: z.string().min(1),
    scope: generationScopeDtoSchema.optional(),
    sourceIds: z.array(z.string().min(1)).min(1).max(50),
    budgetCapUsd: z.number().min(0).max(1000).optional(),
    /** "QA ligera": gates (a)–(h) only, no judge and no editor. Absent means `full`. */
    qaMode: qaModeSchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((config, ctx) => {
    if (!config.sourceIds.includes(config.primarySourceId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['primarySourceId'],
        message: 'the primary source must be one of sourceIds',
      })
    }
    if (new Set(config.sourceIds).size !== config.sourceIds.length) {
      ctx.addIssue({ code: 'custom', path: ['sourceIds'], message: 'sourceIds must not repeat' })
    }
  })
export type GenerationConfigInputDto = z.infer<typeof generationConfigInputSchema>

/** A single stage's priced token counts — mirrors `StageEstimate`. */
const stageEstimateDtoSchema = z.object({
  calls: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  cachedInputTokens: z.number().int().min(0),
  cacheWriteTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  usd: z.number().min(0),
})

/**
 * A stage that costs nothing, which is what an estimate written before that stage existed
 * says about it.
 *
 * `generation_runs.estimate` is a stored column, so a row quoted by sub-phase 8.1 or 8.2 is
 * still read back by this schema today. Making stage 7's fields required would make every one
 * of those rows fail to parse — and `perLessonUsdOf` reads exactly that column to price
 * "profundizar esta lección".
 */
const ZERO_STAGE_DTO = Object.freeze({
  calls: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  usd: 0,
})

/** Mirrors `GenerationEstimate` in `packages/pathgen/src/estimate/estimate-generation.ts`. */
export const generationEstimateDtoSchema = z.object({
  chunks: z.number().int().min(0),
  concepts: z.number().int().min(0),
  modules: z.number().int().min(0),
  /** Expected lessons: what stage 7 will be billed for (sub-phase 8.3). */
  lessons: z.number().int().min(0).default(0),
  p1: stageEstimateDtoSchema,
  p2Outline: stageEstimateDtoSchema,
  p2Modules: stageEstimateDtoSchema,
  p3Lessons: stageEstimateDtoSchema.default(ZERO_STAGE_DTO),
  p4Activities: stageEstimateDtoSchema.default(ZERO_STAGE_DTO),
  p5Flashcards: stageEstimateDtoSchema.default(ZERO_STAGE_DTO),
  /** Stage 8 (sub-phase 8.4): the verifier, the judge, the editor and the regenerations. */
  p6Faithfulness: stageEstimateDtoSchema.default(ZERO_STAGE_DTO),
  p7Judge: stageEstimateDtoSchema.default(ZERO_STAGE_DTO),
  p8Edit: stageEstimateDtoSchema.default(ZERO_STAGE_DTO),
  qaRegenerate: stageEstimateDtoSchema.default(ZERO_STAGE_DTO),
  /** Stage 9 (sub-phase 8.5): the item bank. Defaults for the stored-row reason above. */
  p9Items: stageEstimateDtoSchema.default(ZERO_STAGE_DTO),
  usd: z.number().min(0),
  lowUsd: z.number().min(0),
  highUsd: z.number().min(0),
  minutes: z.object({ low: z.number().min(0), high: z.number().min(0) }),
  dispatch: z.enum(['sync', 'batch']),
  /** `judge` defaults for the same stored-row reason the stage-8 rows do. */
  priced: z.object({ cheap: z.boolean(), smart: z.boolean(), judge: z.boolean().default(false) }),
})
export type GenerationEstimateDto = z.infer<typeof generationEstimateDtoSchema>

/** A warning is `{ code, stage, params }`, rendered by the renderer through
 *  `path:generation.warning.<code>` — see the module doc for why `code`/`stage` are bounded
 *  strings here rather than the full enum `@retenia/pathgen` validates against. */
export const generationWarningDtoSchema = z.object({
  code: z.string().min(1).max(60),
  stage: z.string().min(1).max(30),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.array(z.string())])),
})
export type GenerationWarningDto = z.infer<typeof generationWarningDtoSchema>

const objectiveDtoSchema = z.object({
  text: z.string().min(1).max(300),
  bloom: z.string().min(1).max(20),
})
const sourceRefDtoSchema = z.object({
  source_id: z.string(),
  chunk_id: z.string(),
  chunk_key: z.string().nullable(),
  block_ids: z.array(z.string()),
  heading_path: z.string().nullable(),
  ordinal: z.number().int(),
})

const nodeId = z.string().min(1).max(40)

/** Mirrors `coreLessonNodeSchema` in `packages/pathgen/src/schemas/path-draft.ts`. */
export const coreLessonNodeDtoSchema = z.object({
  id: nodeId,
  kind: z.literal('core'),
  title: z.string(),
  concept_ids: z.array(z.string()),
  warmup_concept_ids: z.array(z.string()).max(1),
  objectives: z.array(objectiveDtoSchema),
  prerequisite_lesson_ids: z.array(nodeId),
  estimated_minutes: z.number(),
  source_refs: z.array(sourceRefDtoSchema),
  origin: z.enum(['model', 'split', 'merged', 'catch_up']),
})

export const reinforcementNodeDtoSchema = z.object({
  id: nodeId,
  kind: z.literal('reinforcement'),
  module_id: nodeId,
  concept_ids: z.array(z.string()),
  earlier_concept_ids: z.array(z.string()),
  item_count: z.number().int(),
  estimated_minutes: z.number(),
})

export const checkpointNodeDtoSchema = z.object({
  id: nodeId,
  kind: z.literal('checkpoint'),
  module_ids: z.array(nodeId),
  concept_ids: z.array(z.string()),
  item_count: z.number().int(),
  estimated_minutes: z.number(),
})

export const moduleNodeDtoSchema = z.object({
  id: nodeId,
  title: z.string(),
  objectives: z.array(objectiveDtoSchema),
  concept_ids: z.array(z.string()),
  lessons: z.array(coreLessonNodeDtoSchema),
  reinforcement: reinforcementNodeDtoSchema,
  checkpoint: checkpointNodeDtoSchema.nullable(),
  estimated_minutes: z.number(),
})

export type CoreLessonNodeDto = z.infer<typeof coreLessonNodeDtoSchema>
export type ReinforcementNodeDto = z.infer<typeof reinforcementNodeDtoSchema>
export type CheckpointNodeDto = z.infer<typeof checkpointNodeDtoSchema>
export type ModuleNodeDto = z.infer<typeof moduleNodeDtoSchema>

export const sectionNodeDtoSchema = z.object({
  id: nodeId,
  title: z.string(),
  modules: z.array(moduleNodeDtoSchema),
})
export type SectionNodeDto = z.infer<typeof sectionNodeDtoSchema>

export const finalExamNodeDtoSchema = z.object({
  id: z.literal('FINAL'),
  kind: z.literal('final_exam'),
  blueprint: z.object({
    topics: z.array(z.object({ module_id: nodeId, weight: z.number() })),
    item_count: z.number().int(),
  }),
  estimated_minutes: z.number(),
})

export const pathStatsDtoSchema = z.object({
  sections: z.number().int(),
  modules: z.number().int(),
  lessons: z.number().int(),
  checkpoints: z.number().int(),
  concepts: z.number().int(),
  minutes: z.number(),
  weeks_estimate: z.number().nullable(),
})
export type PathStatsDto = z.infer<typeof pathStatsDtoSchema>

/** Mirrors `pathDraftSchema` in `packages/pathgen/src/schemas/path-draft.ts` — what
 *  `pathgen.getVersion`/`pathgen.editDraft` carry, and what the preview and completion screens
 *  render directly. */
export const pathDraftDtoSchema = z.object({
  version: z.literal(1),
  kind: z.literal('draft'),
  title: z.string(),
  language: z.string(),
  /** The language the path *teaches*, for a language path; `null` for every other one. Zod
   *  strips what it does not declare, so leaving it out would make the preview unable to show
   *  a field the wizard collects — the draft on disk keeps it either way. */
  target_language: z.string().nullable(),
  level: z.string(),
  goal: z.string(),
  target_date: z.string().nullable(),
  sources: z.array(z.object({ source_id: z.string(), title: z.string(), primary: z.boolean() })),
  sections: z.array(sectionNodeDtoSchema),
  final_exam: finalExamNodeDtoSchema,
  misconceptions: z.array(
    z.object({ id: z.string(), concept_id: z.string(), text: z.string(), why_wrong: z.string() }),
  ),
  excluded: z.array(z.object({ heading_path: z.string(), reason: z.string() })),
  stats: pathStatsDtoSchema,
  warnings: z.array(generationWarningDtoSchema),
  known_node_ids: z.array(z.string()),
  /** Stage 8's depth, chosen in the wizard and frozen with the draft (sub-phase 8.4). Defaults
   *  here — unlike `known_node_ids` — because main parses the stored spec with pathgen's own
   *  schema, which fills it, and a draft frozen before the field existed means `full`. */
  qa_mode: qaModeSchema.default('full'),
})
export type PathDraftDto = z.infer<typeof pathDraftDtoSchema>

/** Mirrors `PathEditOp` in `packages/pathgen/src/edit/types.ts`. */
export const pathEditOpDtoSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rename'), nodeId, title: z.string().trim().min(1).max(200) }),
  z.object({ kind: z.literal('reorder'), nodeId, toIndex: z.number().int().min(0) }),
  z.object({ kind: z.literal('exclude'), nodeId }),
  z.object({ kind: z.literal('markKnown'), nodeId }),
  z.object({ kind: z.literal('unmarkKnown'), nodeId }),
  z.object({
    kind: z.literal('mergeLessons'),
    lessonIds: z.array(nodeId).min(2).max(12),
  }),
  z.object({
    kind: z.literal('splitLesson'),
    lessonId: nodeId,
    parts: z.union([z.literal(2), z.literal(3)]),
  }),
  z.object({
    kind: z.literal('deepenLesson'),
    lessonId: nodeId,
    parts: z.union([z.literal(2), z.literal(3)]),
  }),
  z.object({ kind: z.literal('setPrimarySource'), sourceId: z.string().min(1) }),
  z.object({ kind: z.literal('replace'), draft: pathDraftDtoSchema }),
])
export type PathEditOpDto = z.infer<typeof pathEditOpDtoSchema>

export const pathDtoSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  language: z.string(),
  level: z.string().nullable(),
  goal: z.string().nullable(),
  targetDate: z.string().nullable(),
  status: z.enum(['draft', 'generating', 'active', 'completed', 'archived']),
  activeVersion: z.number().int().nullable(),
})
export type PathDto = z.infer<typeof pathDtoSchema>

export const pathVersionDtoSchema = z.object({
  id: z.uuid(),
  pathId: z.uuid(),
  number: z.number().int(),
  frozenAt: z.iso.datetime().nullable(),
})
export type PathVersionDto = z.infer<typeof pathVersionDtoSchema>

export const generationRunDtoSchema = z.object({
  id: z.uuid(),
  pathId: z.uuid(),
  pathVersionId: z.uuid().nullable(),
  status: generationRunStatusSchema,
  progress: z.object({
    stage: generationStageSchema,
    done: z.number().int(),
    total: z.number().int(),
  }),
  estimate: generationEstimateDtoSchema.nullable(),
  costUsd: z.number().min(0),
  warnings: z.array(generationWarningDtoSchema),
  error: z.string().nullable(),
})
export type GenerationRunDto = z.infer<typeof generationRunDtoSchema>

export const generationResultDtoSchema = z.object({
  runId: z.uuid(),
  pathId: z.uuid(),
  pathVersionId: z.uuid().nullable(),
  status: generationRunStatusSchema,
  warnings: z.array(generationWarningDtoSchema),
  draft: pathDraftDtoSchema.nullable(),
  error: z.string().nullable(),
})
export type GenerationResultDto = z.infer<typeof generationResultDtoSchema>

/** How far one lesson's expansion has got — `lessons.status`, mirrored for the renderer.
 *  `qa` is written but not yet through §5's gates; `ready` is the gates' verdict (8.4). */
export const LESSON_STATUSES = ['pending', 'generating', 'qa', 'ready', 'failed'] as const
export const lessonStatusDtoSchema = z.enum(LESSON_STATUSES)
export type LessonStatusDto = z.infer<typeof lessonStatusDtoSchema>

/** Mirrors `QA_VERDICTS` / `QA_GATES` in `packages/pathgen/src/qa/lesson-qa.ts`. */
export const QA_VERDICTS = ['pass', 'fixed', 'regenerated', 'flagged'] as const
export const qaVerdictSchema = z.enum(QA_VERDICTS)
export type QaVerdictDto = z.infer<typeof qaVerdictSchema>
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
export const qaGateSchema = z.enum(QA_GATES)
export type QaGateDto = z.infer<typeof qaGateSchema>

/**
 * What a badge needs of `lessons.qa` (`docs/spec/04-path-generation.md` §13 step 5: *"QA
 * indicators (fidelity, sources)"*) — mirrors pathgen's `LessonQaSummary`. The findings
 * themselves travel on `pathgen.getQaReport`, not here: the panel shows a chip, not a report.
 */
export const lessonQaSummaryDtoSchema = z.object({
  /** supported ÷ evaluated claims, 0–1; `null` when the lesson made no cited claim. */
  faithfulness: z.number().min(0).max(1).nullable(),
  /** The mean of the judge's criteria, 1–5; `null` in light mode or when it did not run. */
  pedagogyScore: z.number().min(1).max(5).nullable(),
  coverageOk: z.boolean(),
  verdict: qaVerdictSchema,
  /** Every gate ran to a conclusion — "revisado". A flagged lesson is reviewed too. */
  reviewed: z.boolean(),
  sourcesCount: z.number().int().min(0),
  findings: z.number().int().min(0),
})
export type LessonQaSummaryDto = z.infer<typeof lessonQaSummaryDtoSchema>

/**
 * One row of the expansion panel (sub-phase 8.3, `docs/spec/04-path-generation.md` §13 step
 * 5): *"lessons appear progressively; the first is ready in < 1 min; each lesson with
 * 'Regenerate', 'More examples', 'Report an error' (opens the citation)"*.
 *
 * Deliberately not the lesson itself. The theory is a document the player renders (9.2) and
 * would be tens of kilobytes per lesson across the IPC boundary for a list that shows a chip
 * and three buttons; `firstCitation` is what "Reportar error" needs and nothing more.
 */
export const lessonSummaryDtoSchema = z.object({
  id: z.uuid(),
  specId: z.string(),
  moduleTitle: z.string(),
  title: z.string(),
  status: lessonStatusDtoSchema,
  activities: z.number().int().min(0),
  flashcards: z.number().int().min(0),
  /** The practice rules the generated pool could not satisfy, for the quiet note. */
  unmet: z.array(z.object({ rule: z.string(), detail: z.string() })),
  warnings: z.array(generationWarningDtoSchema),
  /**
   * Where to open the source at, for "Reportar error".
   *
   * `locator` is the display label the parser produced (`p. 8`, `12:30–13:45`) and cannot be
   * parsed back into a position, so `page` carries the number the reader route actually takes;
   * it is `null` for a source that has no pages at all, and the link then opens the source at
   * its start.
   */
  firstCitation: z
    .object({
      sourceId: z.uuid(),
      locator: z.string(),
      page: z.int().positive().nullable(),
      blockIds: z.array(z.string()),
    })
    .nullable(),
  /** The gates' verdict, once there is one (sub-phase 8.4); `null` until the lesson is `ready`. */
  qa: lessonQaSummaryDtoSchema.nullable(),
})
export type LessonSummaryDto = z.infer<typeof lessonSummaryDtoSchema>

/**
 * One flagged thing of the QA report (§13 step 5's "Report an error (opens the citation)",
 * applied to what the gates found): the sentence, which gate said what, and the citations it
 * carries resolved to something the reader route can open — `page` for a paged source, the
 * source's start otherwise, exactly as `firstCitation` above.
 */
/** Mirrors `MAX_FINDINGS` in `packages/pathgen/src/qa/lesson-qa.ts`: what a lesson's row holds. */
export const QA_MAX_FINDINGS = 50
/** A theory block cites at most 12 ids (`lessonTheorySchema`); a finding never carries more. */
export const QA_MAX_FINDING_CITATIONS = 12

export const qaFindingDtoSchema = z.object({
  gate: qaGateSchema,
  kind: z.string().min(1).max(40),
  blockIndex: z.number().int().min(0).nullable(),
  sentence: z.string().max(300),
  detail: z.string().max(300),
  citations: z
    .array(
      z.object({
        id: z.string().max(64),
        sourceId: z.uuid(),
        locator: z.string().max(1_000),
        page: z.int().positive().nullable(),
        blockIds: z.array(z.string().max(256)).max(256),
      }),
    )
    .max(QA_MAX_FINDING_CITATIONS),
})
export type QaFindingDto = z.infer<typeof qaFindingDtoSchema>

export const qaReportLessonDtoSchema = z.object({
  lessonId: z.uuid(),
  specId: z.string().max(64),
  moduleTitle: z.string().max(1_000),
  title: z.string().max(1_000),
  status: lessonStatusDtoSchema,
  qa: lessonQaSummaryDtoSchema.nullable(),
  gates: z
    .array(
      z.object({ gate: qaGateSchema, outcome: z.enum(['pass', 'fix', 'regenerate', 'skipped']) }),
    )
    .max(QA_GATES.length),
  findings: z.array(qaFindingDtoSchema).max(QA_MAX_FINDINGS),
  warnings: z.array(generationWarningDtoSchema),
})
export type QaReportLessonDto = z.infer<typeof qaReportLessonDtoSchema>

export const qaReportDtoSchema = z.object({
  totals: z.object({
    lessons: z.number().int().min(0),
    reviewed: z.number().int().min(0),
    flagged: z.number().int().min(0),
    /** Over the lessons that have one; `null` when none does. */
    meanFaithfulness: z.number().min(0).max(1).nullable(),
  }),
  lessons: z.array(qaReportLessonDtoSchema),
})
export type QaReportDto = z.infer<typeof qaReportDtoSchema>

/** What "Regenerar" and "Más ejemplos" mean, as one closed choice. */
export const LESSON_REGENERATE_MODES = ['regenerate', 'more_examples'] as const
export const lessonRegenerateModeSchema = z.enum(LESSON_REGENERATE_MODES)
export type LessonRegenerateModeDto = z.infer<typeof lessonRegenerateModeSchema>

// --- stage 9 and the prior-knowledge diagnostic (sub-phase 8.5) ------------------------------

/** `ItemBankItem.v1.usage` (`docs/spec/04-path-generation.md` §8). */
export const ITEM_USAGE_DTOS = [
  'diagnostic',
  'reinforcement',
  'final_exam_A',
  'final_exam_B',
  'remediation',
  'mock',
] as const
export const itemUsageDtoSchema = z.enum(ITEM_USAGE_DTOS)
export type ItemUsageDto = z.infer<typeof itemUsageDtoSchema>

const count = z.int().min(0)

/**
 * The item bank of one frozen version. `building` while a build runs; `ready` when every
 * blueprint cell has its items; `partial` when some cell failed or came short (the diagnostic
 * still runs on what exists); `failed` when the build itself threw.
 */
export const itemBankStatusDtoSchema = z.object({
  pathVersionId: z.uuid(),
  state: z.enum(['empty', 'building', 'ready', 'partial', 'failed']),
  items: count,
  diagnosticItems: count,
  byUsage: z.object({
    diagnostic: count,
    reinforcement: count,
    final_exam_A: count,
    final_exam_B: count,
    remediation: count,
    mock: count,
  }),
  cells: z.object({ total: count, built: count, short: count, failed: count }),
  warnings: z.array(generationWarningDtoSchema),
  error: z.string().max(2_000).nullable(),
})
export type ItemBankStatusDto = z.infer<typeof itemBankStatusDtoSchema>

/** §10 step 1's four levels, per section. `never` is never asked. */
export const SELF_ASSESSMENT_LEVEL_DTOS = ['never', 'familiar', 'know', 'master'] as const
export const selfAssessmentLevelDtoSchema = z.enum(SELF_ASSESSMENT_LEVEL_DTOS)
export type SelfAssessmentLevelDto = z.infer<typeof selfAssessmentLevelDtoSchema>

export const diagnosticEntryDtoSchema = z.enum(['scratch', 'partial'])
export type DiagnosticEntryDto = z.infer<typeof diagnosticEntryDtoSchema>

export const diagnosticStopReasonDtoSchema = z.enum([
  'from_scratch',
  'all_classified',
  'no_items',
  'max_items',
  'time_limit',
  'abandoned',
])
export type DiagnosticStopReasonDto = z.infer<typeof diagnosticStopReasonDtoSchema>

export const diagnosticConfidenceDtoSchema = z.enum(['sure', 'unsure', 'guessed'])
export type DiagnosticConfidenceDto = z.infer<typeof diagnosticConfidenceDtoSchema>

export const diagnosticModuleStatusDtoSchema = z.enum(['known', 'partial', 'unknown'])
export type DiagnosticModuleStatusDto = z.infer<typeof diagnosticModuleStatusDtoSchema>

export const diagnosticSectionDtoSchema = z.object({
  id: z.uuid(),
  specId: z.string().max(64),
  title: z.string().max(1_000),
  modules: z.array(
    z.object({ id: z.uuid(), specId: z.string().max(64), title: z.string().max(1_000) }),
  ),
  /** Already "ya lo sé" in the preview: shown as known, never asked. */
  selfDeclared: z.boolean(),
})
export type DiagnosticSectionDto = z.infer<typeof diagnosticSectionDtoSchema>

/** The item on screen. `activity` is the `ActivityBase` envelope the host renders. */
export const diagnosticItemDtoSchema = z.object({
  itemBankId: z.uuid(),
  attemptId: z.uuid(),
  activityId: z.uuid(),
  type: z.string().min(1).max(64),
  activity: z.json(),
  /** The seed the host derives its option shuffle from, so a re-render is stable. */
  seed: z.string().max(200),
})
export type DiagnosticItemDto = z.infer<typeof diagnosticItemDtoSchema>

export const diagnosticModuleResultDtoSchema = z.object({
  moduleId: z.uuid(),
  specId: z.string().max(64),
  title: z.string().max(1_000),
  sectionTitle: z.string().max(1_000),
  status: diagnosticModuleStatusDtoSchema,
  source: z.enum(['diagnostic', 'never_seen', 'from_scratch', 'self_declared', 'unevidenced']),
  /** The "avanzado" values: θ, P = σ(θ), and the evidence counts. */
  theta: z.number(),
  p: z.number().min(0).max(1),
  answered: count,
  inferred: count,
  quickReview: z.boolean(),
  lessonsCompleted: count,
  seededCards: count,
  /** Lessons of a known module still waiting for their cards to be written. */
  pendingSeedLessons: count,
  reverted: z.boolean(),
  reopened: z.boolean(),
  reopenReason: z.enum(['lapses', 'low_retention']).nullable(),
})
export type DiagnosticModuleResultDto = z.infer<typeof diagnosticModuleResultDtoSchema>

export const diagnosticResultDtoSchema = z.object({
  stopReason: diagnosticStopReasonDtoSchema,
  asked: count,
  elapsedMs: count,
  modules: z.array(diagnosticModuleResultDtoSchema),
  /** `insert_remediation`, recorded for sub-phase 8.6's P11. */
  remediations: z.array(
    z.object({
      moduleId: z.uuid(),
      conceptIds: z.array(z.string().max(128)).max(16),
      misconceptionId: z.string().max(64).nullable(),
    }),
  ),
})
export type DiagnosticResultDto = z.infer<typeof diagnosticResultDtoSchema>

export const diagnosticStateDtoSchema = z.object({
  session: z.object({
    id: z.uuid(),
    pathVersionId: z.uuid(),
    status: z.enum(['in_progress', 'completed']),
    entry: z.enum(['scratch', 'partial', 'preview']),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
    stopReason: diagnosticStopReasonDtoSchema.nullable(),
  }),
  progress: z.object({
    asked: count,
    /** "Quedan ~N". An estimate: the bar says "~". */
    remaining: count,
    elapsedMs: count,
    maxItems: count,
  }),
  item: diagnosticItemDtoSchema.nullable(),
  result: diagnosticResultDtoSchema.nullable(),
})
export type DiagnosticStateDto = z.infer<typeof diagnosticStateDtoSchema>

export const pathgenChannels = defineContract({
  /** The wizard's step-1 live estimate — never writes anything (§13 step 1). */
  'pathgen.quote': {
    input: z.object({ config: generationConfigInputSchema }),
    output: z.object({
      estimate: generationEstimateDtoSchema,
      warnings: z.array(generationWarningDtoSchema),
    }),
  },

  'pathgen.start': {
    input: z.object({
      config: generationConfigInputSchema,
      pathId: z.uuid().optional(),
      userWaiting: z.boolean().optional(),
      allowOverBudget: z.boolean().optional(),
    }),
    output: generationResultDtoSchema,
  },

  'pathgen.resume': {
    input: z.object({ runId: z.uuid(), allowOverBudget: z.boolean().optional() }),
    output: generationResultDtoSchema,
  },

  'pathgen.cancel': {
    input: z.object({ runId: z.uuid() }),
    output: z.object({ run: generationRunDtoSchema.nullable() }),
  },

  /** Reconnects to an in-flight or finished run — e.g. after navigating away, or reopening the
   *  app while a batch run is still being polled. */
  'pathgen.getRun': {
    input: z.object({ runId: z.uuid() }),
    output: z.object({ run: generationRunDtoSchema.nullable() }),
  },

  /** Feeds both the editable preview and the completion screen. */
  'pathgen.getVersion': {
    input: z.object({ pathVersionId: z.uuid() }),
    output: z.object({
      path: pathDtoSchema,
      version: pathVersionDtoSchema,
      draft: pathDraftDtoSchema,
    }),
  },

  /** The editable preview's whole write surface (§13 step 3). Rejected once the version is
   *  frozen — "frozen paths reject structural edits". */
  'pathgen.editDraft': {
    input: z.object({ pathVersionId: z.uuid(), op: pathEditOpDtoSchema }),
    output: z.object({
      draft: pathDraftDtoSchema,
      warnings: z.array(generationWarningDtoSchema),
      breaksPrerequisite: z.boolean(),
      projectedCostDeltaUsd: z.number().optional(),
    }),
  },

  /**
   * Stage 7: expands every lesson of a frozen version that is not `ready` yet
   * (`docs/spec/04-path-generation.md` §3 stage 7). Safe to call again — an expansion that is
   * already running is continued rather than duplicated, and a lesson that is already written
   * is reused rather than paid for twice.
   */
  'pathgen.expand': {
    input: z.object({
      pathVersionId: z.uuid(),
      userWaiting: z.boolean().optional(),
      allowOverBudget: z.boolean().optional(),
    }),
    output: z.object({ run: generationRunDtoSchema }),
  },

  /** The expansion panel's list. Cheap enough to poll, and pushed by `pathgen.lessonStatus`. */
  'pathgen.getLessons': {
    input: z.object({ pathVersionId: z.uuid() }),
    output: z.object({ lessons: z.array(lessonSummaryDtoSchema) }),
  },

  /**
   * Stage 8's report for one path version (sub-phase 8.4): every core lesson with its verdict
   * and the sentences the gates flagged, each with its citations resolved to something the
   * reader can open. Read-only; the gates themselves run inside `pathgen.expand`.
   */
  'pathgen.getQaReport': {
    input: z.object({ pathVersionId: z.uuid() }),
    output: qaReportDtoSchema,
  },

  /**
   * §13 step 5's per-lesson buttons. `regenerate` replaces the lesson — theory, practice and
   * cards — and forces past the cached answer; `more_examples` adds to the practice block and
   * leaves everything else where it is.
   */
  'pathgen.regenerateLesson': {
    input: z.object({ lessonId: z.uuid(), mode: lessonRegenerateModeSchema }),
    output: z.object({ run: generationRunDtoSchema, lesson: lessonSummaryDtoSchema.nullable() }),
  },

  /** "Confirmar ruta" (§13 step 3): materializes the tree and sets `frozen_at`. */
  'pathgen.freeze': {
    input: z.object({ pathVersionId: z.uuid() }),
    output: z.object({
      path: pathDtoSchema,
      version: pathVersionDtoSchema,
      stats: pathStatsDtoSchema,
    }),
  },

  /**
   * Stage 9 (sub-phase 8.5): builds — or resumes building — the item bank of a frozen version.
   * Started by the freeze itself; this is the retry. Returns at once with `state: 'building'`;
   * poll `pathgen.getItemBank` for the outcome.
   */
  'pathgen.buildItemBank': {
    input: z.object({ pathVersionId: z.uuid(), allowOverBudget: z.boolean().optional() }),
    output: itemBankStatusDtoSchema,
  },

  'pathgen.getItemBank': {
    input: z.object({ pathVersionId: z.uuid() }),
    output: itemBankStatusDtoSchema,
  },

  /** The diagnostic screen's first read: the sections to self-assess and any session to resume. */
  'pathgen.diagnosticGet': {
    input: z.object({ pathVersionId: z.uuid() }),
    output: z.object({
      sections: z.array(diagnosticSectionDtoSchema),
      state: diagnosticStateDtoSchema.nullable(),
      itemBank: itemBankStatusDtoSchema,
    }),
  },

  /**
   * §10 step 1. `scratch` finishes at once (everything unknown, nothing asked); `partial`
   * starts the adaptive loop and serves the first item. Resumes an open session instead of
   * starting a second one.
   */
  'pathgen.diagnosticStart': {
    input: z.object({
      pathVersionId: z.uuid(),
      entry: diagnosticEntryDtoSchema,
      selfAssessment: z
        .record(z.string().min(1).max(64), selfAssessmentLevelDtoSchema)
        .refine((levels) => Object.keys(levels).length <= 200, 'at most 200 sections'),
    }),
    output: diagnosticStateDtoSchema,
  },

  /**
   * §10 step 3. Main grades the answer itself from `response` — the host's choice response,
   * `{ sets: [{ selected: [optionId] }] }` — rather than trusting a verdict from the renderer.
   * Serves the next item, or finishes the diagnostic and applies its result.
   */
  'pathgen.diagnosticAnswer': {
    input: z.object({
      sessionId: z.uuid(),
      attemptId: z.uuid(),
      skipped: z.boolean(),
      // Exactly the choice host's response shape, bounded: extra fields are stripped and a
      // payload of any other size or depth never reaches main.
      response: z
        .object({
          sets: z
            .array(z.object({ selected: z.array(z.string().min(1).max(64)).max(8) }))
            .min(1)
            .max(4),
        })
        .optional(),
      confidence: diagnosticConfidenceDtoSchema.nullable(),
      timeMs: z.int().min(0).max(3_600_000),
    }),
    output: diagnosticStateDtoSchema,
  },

  /** "Terminar ahora" (§10 step 7, abandonment): stop with what is known and apply it. */
  'pathgen.diagnosticFinish': {
    input: z.object({ sessionId: z.uuid() }),
    output: diagnosticStateDtoSchema,
  },

  /**
   * The summary's one-click undo (§13 step 4, "reversible"): one module's `mark_completed` and
   * `seed_memory` taken back, or every module's when `moduleId` is absent.
   */
  'pathgen.diagnosticRevert': {
    input: z.object({ sessionId: z.uuid(), moduleId: z.uuid().optional() }),
    output: diagnosticStateDtoSchema,
  },
})
