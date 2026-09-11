import { GENERATION_RUN_STATUSES } from '@retenia/core'
import { z } from 'zod'
import { generationWarningSchema } from './warnings'

/**
 * `GenerationManifest.v1` — `docs/spec/04-path-generation.md` §7 and §8: "source hashes,
 * prompt and schema versions, model and version, temperature, seed if it exists, tokens and
 * cost, warnings", extended with what a regeneration diff and a cost calibration need.
 *
 * Written to `generation_runs.manifest` at every stage boundary — `stage` says how far the
 * run got, so a crash leaves a manifest that explains itself — and to the version when the
 * draft is persisted.
 */

export const MANIFEST_VERSION = 1
export const MANIFEST_SCHEMA_ID = 'generation_manifest@1'

export const manifestModelSchema = z.object({
  /** The primary target the role resolved to when the run started; `null` if unconfigured. */
  provider: z.string().nullable(),
  model: z.string().nullable(),
  temperature: z.number(),
  /** Providers offer no seed for these calls; kept so the field §8 names is visibly null. */
  seed: z.null(),
  /** Every model that actually answered, fallbacks included, sorted. */
  models_used: z.array(z.string()),
})

export const manifestCostSchema = z.object({
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  cached_tokens: z.number().int().min(0),
  usd: z.number().min(0),
  /** Provider calls made. */
  calls: z.number().int().min(0),
  /** Answers replayed from `ai_results` or `extractions` without a call. */
  cache_hits: z.number().int().min(0),
})

export const manifestStatsSchema = z.object({
  chunks_total: z.number().int().min(0),
  chunks_in_scope: z.number().int().min(0),
  chunks_frontmatter: z.number().int().min(0),
  chunks_extracted: z.number().int().min(0),
  chunks_reused: z.number().int().min(0),
  chunks_failed: z.number().int().min(0),
  concepts_raw: z.number().int().min(0),
  concepts: z.number().int().min(0),
  nodes: z.number().int().min(0),
  edges: z.number().int().min(0),
  sections: z.number().int().min(0),
  modules: z.number().int().min(0),
  lessons: z.number().int().min(0),
})

export const generationManifestSchema = z.object({
  version: z.literal(MANIFEST_VERSION),
  created_at: z.string(),
  run_id: z.string(),
  /** The run's status when this manifest was written. */
  stage: z.enum(GENERATION_RUN_STATUSES),
  config: z.record(z.string(), z.unknown()),
  config_hash: z.string().length(64),
  source_hashes: z.array(
    z.object({
      source_id: z.string(),
      blob_sha256: z.string().nullable(),
      /** sha256 over the sorted chunk keys in scope — what "the same book" means to a re-run. */
      chunk_set_hash: z.string().length(64),
      chunk_count: z.number().int().min(0),
      chunking_version: z.string().nullable(),
    }),
  ),
  /** `promptVersionSnapshot()`: every registered prompt, not only the three this run used. */
  prompt_versions: z.record(z.string(), z.string()),
  schema_versions: z.object({
    extract_chunk: z.string(),
    synthesize_outline: z.string(),
    synthesize_module: z.string(),
    knowledge_graph: z.string(),
    path_draft: z.string(),
    manifest: z.string(),
  }),
  /**
   * Keyed by pipeline stage id (`P1_extract_chunk`, `P2_synthesize_outline`,
   * `P2_synthesize_module`, and — once expansion/QA have run — `P3_write_lesson`,
   * `P4_make_activities`, `P5_make_flashcards`, `P6_faithfulness`, `P7_pedagogy_judge`,
   * `P8_edit`). §8 describes this as an open map, not a fixed set of keys: draft persistence
   * writes the P1/P2 entries; `expansion-run.ts` merges in the rest after `expandLessons` and
   * the QA pipeline complete. P9 (item bank) and P11 (remediation) don't track model usage
   * anywhere yet, so they have no entry here — see the comment in `expansion-run.ts`.
   */
  models: z.record(z.string(), manifestModelSchema),
  embeddings: z.object({
    model_id: z.string().nullable(),
    dims: z.number().int().nullable(),
    threshold: z.number(),
  }),
  sequencing: z.object({
    algorithm_version: z.string(),
    /** The inputs digest the seeded shuffles drew from. */
    seed: z.string(),
  }),
  cost: manifestCostSchema,
  stats: manifestStatsSchema,
  warnings: z.array(generationWarningSchema),
})

export type GenerationManifest = z.infer<typeof generationManifestSchema>
export type ManifestModel = z.infer<typeof manifestModelSchema>
export type ManifestCost = z.infer<typeof manifestCostSchema>
export type ManifestStats = z.infer<typeof manifestStatsSchema>
