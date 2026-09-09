import { BLOOM_LEVELS } from '@retenia/core'
import { z } from 'zod'
import { CONCEPT_KINDS } from '../validate/types'

/**
 * `extract_chunk@1` — what P1 returns for one chunk (`docs/spec/04-path-generation.md` §3
 * stage 3, §9). The `schema:` line of `packages/ai/prompts/P1_extract_chunk/1.md` names this
 * version, and it is the `schemaVersion` half of every P1 `custom_id`: a change here is new
 * work for every chunk, which is exactly right.
 *
 * Strict-mode safe: flat objects, enums rather than unions, no recursion, no optionals.
 * Bounds are generous — the validation gates repair what is off, and a zod failure costs a
 * repair turn — but they are bounds: a model that returns 400 concepts for one chunk has not
 * read the chunk.
 */

export const EXTRACT_CHUNK_SCHEMA_NAME = 'extract_chunk'
export const EXTRACT_CHUNK_SCHEMA_VERSION = '1'
/** The `schema:` value of the prompt file. */
export const EXTRACT_CHUNK_SCHEMA_ID = `${EXTRACT_CHUNK_SCHEMA_NAME}@${EXTRACT_CHUNK_SCHEMA_VERSION}`

export const EXERCISE_KINDS = ['problem', 'question', 'worked_example', 'other'] as const

export const extractedConceptSchema = z.object({
  canonical: z.string().min(1).max(120),
  aliases: z.array(z.string().min(1).max(120)).max(8),
  definition: z.string().min(1).max(600),
  kind: z.enum(CONCEPT_KINDS),
  importance: z.number().min(0).max(1),
  difficulty: z.number().int().min(1).max(5),
})

export const extractChunkOutputSchema = z.object({
  concepts: z.array(extractedConceptSchema).max(25),
  claims: z
    .array(
      z.object({
        text: z.string().min(1).max(400),
        block_ids: z.array(z.string().min(1).max(64)).max(10),
      }),
    )
    .max(30),
  objectives: z
    .array(z.object({ text: z.string().min(1).max(200), bloom: z.enum(BLOOM_LEVELS) }))
    .max(8),
  prerequisites_mentioned: z.array(z.string().min(1).max(120)).max(15),
  figures: z
    .array(z.object({ label: z.string().max(200), description: z.string().max(400) }))
    .max(10),
  exercises: z.array(z.object({ text: z.string().max(600), kind: z.enum(EXERCISE_KINDS) })).max(10),
  /** The model's own verdict that the chunk is a table of contents, an index, a copyright
   *  page… — the second guard behind `chunks.is_frontmatter` (§14 pitfall 6). */
  is_frontmatter_like: z.boolean(),
})

export type ExtractedConcept = z.infer<typeof extractedConceptSchema>
export type ExtractChunkOutput = z.infer<typeof extractChunkOutputSchema>

/** What an extraction of nothing looks like — the row stored for a front-matter-like chunk. */
export const EMPTY_EXTRACTION: ExtractChunkOutput = Object.freeze({
  concepts: [],
  claims: [],
  objectives: [],
  prerequisites_mentioned: [],
  figures: [],
  exercises: [],
  is_frontmatter_like: true,
})
