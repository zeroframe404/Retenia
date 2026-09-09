import { BLOOM_LEVELS } from '@retenia/core'
import { z } from 'zod'
import { EDGE_KINDS } from '../validate/types'

/**
 * The two P2 contracts of `docs/spec/04-path-generation.md` §3 stage 4, "outline first, then
 * expand": `synthesize_outline@1` is the skeleton — the knowledge graph over the consolidated
 * concept ids, and sections with modules — and `synthesize_module@1` is one module's lesson
 * specs and misconceptions, asked once per module over the same cached prefix.
 *
 * Neither asks the model for anything the code already knows: no canonicals, definitions or
 * source refs come back (they are attached from the consolidated concepts), and no ids are
 * assigned by the model (sections, modules and lessons are numbered by position after
 * sequencing). Bounds are wide enough that an answer slightly off the spec's targets — a
 * lesson of six concepts, a module of two lessons — is repaired by the validation gates
 * rather than costing a repair turn; the prompt states the targets, the gates hold them.
 */

export const SYNTHESIZE_OUTLINE_SCHEMA_NAME = 'synthesize_outline'
export const SYNTHESIZE_OUTLINE_SCHEMA_VERSION = '1'
export const SYNTHESIZE_OUTLINE_SCHEMA_ID = `${SYNTHESIZE_OUTLINE_SCHEMA_NAME}@${SYNTHESIZE_OUTLINE_SCHEMA_VERSION}`

export const SYNTHESIZE_MODULE_SCHEMA_NAME = 'synthesize_module'
export const SYNTHESIZE_MODULE_SCHEMA_VERSION = '1'
export const SYNTHESIZE_MODULE_SCHEMA_ID = `${SYNTHESIZE_MODULE_SCHEMA_NAME}@${SYNTHESIZE_MODULE_SCHEMA_VERSION}`

export const objectiveSchema = z.object({
  text: z.string().min(1).max(300),
  bloom: z.enum(BLOOM_LEVELS),
})

export const synthesizeOutlineOutputSchema = z.object({
  graph: z.object({
    nodes: z
      .array(
        z.object({
          concept_id: z.string().min(1).max(40),
          bloom_target: z.enum(BLOOM_LEVELS),
          difficulty: z.number().int().min(1).max(5),
          importance: z.number().min(0).max(1),
        }),
      )
      .max(600),
    edges: z
      .array(
        z.object({
          from: z.string().min(1).max(40),
          to: z.string().min(1).max(40),
          kind: z.enum(EDGE_KINDS),
          confidence: z.number().min(0).max(1),
        }),
      )
      .max(1500),
  }),
  sections: z
    .array(
      z.object({
        title: z.string().min(1).max(160),
        modules: z
          .array(
            z.object({
              title: z.string().min(1).max(160),
              objectives: z.array(objectiveSchema).max(6),
              concept_ids: z.array(z.string().min(1).max(40)).min(1).max(40),
            }),
          )
          .min(1)
          .max(12),
      }),
    )
    .min(1)
    .max(16),
  excluded: z
    .array(
      z.object({
        heading_path: z.string().min(1).max(500),
        reason: z.string().min(1).max(200),
      }),
    )
    .max(50),
  warnings: z.array(z.string().min(1).max(500)).max(20),
})

export const synthesizeModuleOutputSchema = z.object({
  lesson_specs: z
    .array(
      z.object({
        title: z.string().min(1).max(160),
        concept_ids: z.array(z.string().min(1).max(40)).min(1).max(10),
        objectives: z.array(objectiveSchema).max(6),
        estimated_minutes: z.number().int().min(1).max(60),
      }),
    )
    .min(1)
    .max(12),
  misconceptions: z
    .array(
      z.object({
        concept_id: z.string().min(1).max(40),
        text: z.string().min(1).max(300),
        why_wrong: z.string().min(1).max(300),
      }),
    )
    .max(30),
  warnings: z.array(z.string().min(1).max(500)).max(10),
})

export type SynthesizeOutlineOutput = z.infer<typeof synthesizeOutlineOutputSchema>
export type SynthesizeModuleOutput = z.infer<typeof synthesizeModuleOutputSchema>
