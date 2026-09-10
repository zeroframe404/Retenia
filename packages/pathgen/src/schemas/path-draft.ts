import { z } from 'zod'
import { objectiveSchema } from './outline'
import { generationWarningSchema } from './warnings'

/**
 * `PathDraft.v1` — what sub-phase 8.1 writes into `path_versions.spec` and what 8.2's
 * editable preview reads (`docs/spec/04-path-generation.md` §3 stage 6, §8).
 *
 * `kind: 'draft'` is required so nothing downstream mistakes an unfrozen draft for a frozen
 * `LearningPath.v1`: the two share the section → module → lesson shape, but a draft has no
 * expanded lessons, no diagnostic items and no frozen ids. Every node id is positional
 * (`S01`, `M03`, `L07`, `M03.reinf`, `C02`, `FINAL`) and the freeze keeps them.
 */

export const PATH_DRAFT_VERSION = 1
export const PATH_DRAFT_SCHEMA_ID = 'path_draft@1'

const id = z.string().min(1).max(40)

export const sourceRefSchema = z.object({
  source_id: z.string(),
  chunk_id: z.string(),
  chunk_key: z.string().nullable(),
  block_ids: z.array(z.string()).readonly(),
  heading_path: z.string().nullable(),
  ordinal: z.number().int(),
})

export const coreLessonNodeSchema = z.object({
  id,
  kind: z.literal('core'),
  title: z.string(),
  concept_ids: z.array(z.string()),
  warmup_concept_ids: z.array(z.string()).max(1),
  objectives: z.array(objectiveSchema),
  prerequisite_lesson_ids: z.array(id),
  estimated_minutes: z.number(),
  source_refs: z.array(sourceRefSchema),
  origin: z.enum(['model', 'split', 'merged', 'catch_up']),
})

export const reinforcementNodeSchema = z.object({
  id,
  kind: z.literal('reinforcement'),
  module_id: id,
  concept_ids: z.array(z.string()),
  earlier_concept_ids: z.array(z.string()),
  item_count: z.number().int(),
  estimated_minutes: z.number(),
})

export const checkpointNodeSchema = z.object({
  id,
  kind: z.literal('checkpoint'),
  module_ids: z.array(id),
  concept_ids: z.array(z.string()),
  item_count: z.number().int(),
  estimated_minutes: z.number(),
})

export const moduleNodeSchema = z.object({
  id,
  title: z.string(),
  objectives: z.array(objectiveSchema),
  concept_ids: z.array(z.string()),
  lessons: z.array(coreLessonNodeSchema),
  reinforcement: reinforcementNodeSchema,
  checkpoint: checkpointNodeSchema.nullable(),
  estimated_minutes: z.number(),
})

export const sectionNodeSchema = z.object({
  id,
  title: z.string(),
  modules: z.array(moduleNodeSchema),
})

export const finalExamNodeSchema = z.object({
  id: z.literal('FINAL'),
  kind: z.literal('final_exam'),
  blueprint: z.object({
    topics: z.array(z.object({ module_id: id, weight: z.number() })),
    item_count: z.number().int(),
  }),
  estimated_minutes: z.number(),
})

export const pathStatsSchema = z.object({
  sections: z.number().int(),
  modules: z.number().int(),
  lessons: z.number().int(),
  checkpoints: z.number().int(),
  concepts: z.number().int(),
  minutes: z.number(),
  weeks_estimate: z.number().nullable(),
})

export const draftMisconceptionSchema = z.object({
  /** `X001`, positional. */
  id: z.string().regex(/^X\d{3,}$/),
  concept_id: z.string(),
  text: z.string(),
  why_wrong: z.string(),
})

export const pathDraftSchema = z.object({
  version: z.literal(PATH_DRAFT_VERSION),
  kind: z.literal('draft'),
  title: z.string(),
  language: z.string(),
  level: z.string(),
  goal: z.string(),
  target_date: z.string().nullable(),
  sources: z.array(z.object({ source_id: z.string(), title: z.string(), primary: z.boolean() })),
  sections: z.array(sectionNodeSchema),
  final_exam: finalExamNodeSchema,
  misconceptions: z.array(draftMisconceptionSchema),
  excluded: z.array(z.object({ heading_path: z.string(), reason: z.string() })),
  stats: pathStatsSchema,
  warnings: z.array(generationWarningSchema),
  /** Section/module ids the preview marked "ya lo sé" (sub-phase 8.2,
   *  `docs/spec/04-path-generation.md` §13 step 3). Additive to the schema 8.1 shipped:
   *  absent (defaults to empty) on any draft produced before this field existed. Freezing
   *  turns each into `lessons.completed_at`; real FSRS low-priority seeding needs the memory
   *  system's item creation and stays a `seed_memory` TODO for the diagnostic (8.5). */
  known_node_ids: z.array(z.string()).default([]),
  /** The language the path *teaches*, when it teaches one (`docs/spec/04-path-generation.md`
   *  §7); `null` otherwise. Additive like `known_node_ids`: a draft frozen before this field
   *  existed reads back as `null`, which is what it always meant. */
  target_language: z.string().nullable().default(null),
})

export type PathDraft = z.infer<typeof pathDraftSchema>
export type DraftMisconception = z.infer<typeof draftMisconceptionSchema>
export type SectionNode = z.infer<typeof sectionNodeSchema>
export type ModuleNode = z.infer<typeof moduleNodeSchema>
export type CoreLessonNode = z.infer<typeof coreLessonNodeSchema>
export type ReinforcementNode = z.infer<typeof reinforcementNodeSchema>
export type CheckpointNode = z.infer<typeof checkpointNodeSchema>
export type FinalExamNode = z.infer<typeof finalExamNodeSchema>
export type SourceRef = z.infer<typeof sourceRefSchema>
export type PathStats = z.infer<typeof pathStatsSchema>
