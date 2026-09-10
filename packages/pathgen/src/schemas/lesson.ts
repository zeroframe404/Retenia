import { z } from 'zod'

/**
 * `write_lesson@1` — what P3 returns for one lesson (`docs/spec/04-path-generation.md` §3
 * stage 7, §4 "Anatomy of a lesson", §8's `Lesson.v1.theory`, §9). The `schema:` line of
 * `packages/ai/prompts/P3_write_lesson/1.md` names this version, and it is the
 * `schemaVersion` half of every P3 `custom_id`.
 *
 * Strict-mode safe: flat objects, enums rather than unions, no recursion, no optionals —
 * `nullable` rather than `optional`, because `toStrictJsonSchema` converts with `io: 'output'`
 * (an optional property is one the model may simply omit) and Claude's strict mode counts
 * optional properties against a hard ceiling.
 */

export const WRITE_LESSON_SCHEMA_NAME = 'write_lesson'
export const WRITE_LESSON_SCHEMA_VERSION = '1'
/** The `schema:` value of the prompt file. */
export const WRITE_LESSON_SCHEMA_ID = `${WRITE_LESSON_SCHEMA_NAME}@${WRITE_LESSON_SCHEMA_VERSION}`

/** §8's block types, in the order §4 puts them in. */
export const THEORY_BLOCK_TYPES = [
  'hook',
  'activation_question',
  'explanation',
  'example',
  'worked_example',
  'diagram',
  'misconception',
  'summary',
  'glossary',
  'general_knowledge',
] as const
export type TheoryBlockType = (typeof THEORY_BLOCK_TYPES)[number]

/**
 * The blocks that make a substantive claim, and must therefore carry a citation that resolves
 * (§4's fidelity contract).
 *
 * `hook` and `activation_question` frame rather than assert; `summary` and `glossary` restate
 * what the blocks above them already cited; `diagram` is a rendering of the explanation beside
 * it; and `general_knowledge` is by definition the block for what the sources do not contain.
 * Everything else has to be placeable in a fragment or it is not in the lesson.
 */
export const SUBSTANTIVE_BLOCK_TYPES: readonly TheoryBlockType[] = Object.freeze([
  'explanation',
  'example',
  'worked_example',
  'misconception',
])

export function isSubstantive(type: TheoryBlockType): boolean {
  return SUBSTANTIVE_BLOCK_TYPES.includes(type)
}

/** §4 item 5: diagrams as code, and only in the two dialects the app can render and validate. */
export const DIAGRAM_KINDS = ['mermaid', 'table'] as const

export const theoryDiagramSchema = z.object({
  kind: z.enum(DIAGRAM_KINDS),
  code: z
    .string()
    .min(1)
    .max(4_000)
    .describe('Mermaid source (flowchart, sequenceDiagram or mindmap) or a Markdown table.'),
  alt_text: z.string().min(1).max(300).describe('What the diagram shows, for a screen reader.'),
})

export const theoryBlockSchema = z.object({
  type: z.enum(THEORY_BLOCK_TYPES),
  content: z.string().min(1).max(6_000).describe('Markdown; [cite:B03] markers go inline.'),
  /**
   * The cite ids this block rests on, as a sibling array rather than only as inline markers.
   *
   * §8 is explicit that Claude's structured outputs are "incompatible with the citations
   * feature → citations travel as ids inside the JSON and are verified in code". A sibling
   * array also survives a model that writes the paragraph and forgets the marker, and
   * `citations.ts` reconciles the two: a marker with no sibling id is added, a sibling id
   * with no marker is kept.
   */
  citations: z.array(z.string().min(1).max(64)).max(12),
  /** Only meaningful on a `diagram` block; `null` everywhere else. */
  diagram: theoryDiagramSchema.nullable(),
  /** The `X001` this block corrects, on a `misconception` block; `null` everywhere else. */
  misconception_id: z.string().max(40).nullable(),
})
export type TheoryBlock = z.infer<typeof theoryBlockSchema>

export const glossaryEntrySchema = z.object({
  term: z.string().min(1).max(120),
  /** The term in the source's language when the lesson is written in another (§7). */
  source_language_term: z.string().max(120).nullable(),
  definition: z.string().min(1).max(400),
  /** The concept this term names, when it is one of the lesson's; `null` otherwise. */
  concept_id: z.string().max(40).nullable(),
})

export const writeLessonOutputSchema = z.object({
  blocks: z.array(theoryBlockSchema).min(3).max(24),
  glossary: z.array(glossaryEntrySchema).max(20),
  /** The model's own count, for §4's 600–1,200-word budget. Checked, never trusted. */
  word_count: z.number().int().min(0).max(5_000),
  /** Anything the learner should know: a concept the sources barely explain, a thin section. */
  warnings: z.array(z.string().min(1).max(300)).max(8),
})
export type WriteLessonOutput = z.infer<typeof writeLessonOutputSchema>

/**
 * `Lesson.v1.theory` as it is stored in `lessons.theory` — the blocks after citation
 * resolution, plus the glossary the player renders beside them.
 */
export const lessonTheorySchema = z.object({
  version: z.literal(1),
  blocks: z.array(theoryBlockSchema),
  glossary: z.array(glossaryEntrySchema),
  word_count: z.number().int().min(0),
})
export type LessonTheory = z.infer<typeof lessonTheorySchema>

/** One entry of `lessons.citations`, resolved from a cite id to real block ids (§8). */
export const lessonCitationSchema = z.object({
  /** The short id the model used: `B01`. */
  id: z.string().min(1).max(64),
  source_id: z.string(),
  chunk_id: z.string(),
  /** The source blocks the fragment covers — what a deep link opens. */
  block_ids: z.array(z.string()).readonly(),
  /** `p. 112`, `12:30–13:45`, or the parser's own label. */
  locator: z.string(),
  /**
   * The model's verbatim span, when it appears in the fragment; `null` otherwise.
   *
   * Exact after folding only. Gate 2's fuzzy ≥ 0.85 span check is sub-phase 8.4's, and a
   * quote we cannot prove is a quote we do not store.
   */
  quote: z.string().nullable(),
})
export type LessonCitation = z.infer<typeof lessonCitationSchema>
