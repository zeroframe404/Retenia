import type { BloomLevel } from '@retenia/core'
import type { GenerationWarning } from '../schemas/warnings'

/**
 * The shapes validation and sequencing work on: the knowledge graph and the outline as
 * `docs/spec/04-path-generation.md` §3 stage 4 describes them, in the snake_case the
 * persisted documents (§8) use.
 *
 * These are *structural* types. The zod documents in `../schemas` validate what a model
 * returned and what a row holds; the stages below them read these interfaces so that a
 * hand-built fixture, a property-test generator and a parsed document are all the same
 * thing to them.
 */

/** The kinds P1 extracts — a subset of core's `KNOWLEDGE_ITEM_KINDS`. */
export const CONCEPT_KINDS = [
  'concept',
  'procedure',
  'fact',
  'principle',
  'example',
  'misconception',
] as const
export type ConceptKind = (typeof CONCEPT_KINDS)[number]

export const EDGE_KINDS = ['PREREQ_OF', 'RELATED_TO', 'PART_OF'] as const
export type EdgeKind = (typeof EDGE_KINDS)[number]

/** Where a concept was seen: one chunk of one source, with the blocks it covered. */
export interface SourceRef {
  readonly source_id: string
  readonly chunk_id: string
  readonly chunk_key: string | null
  readonly block_ids: readonly string[]
  readonly heading_path: string | null
  /** The chunk's reading-order position in its source. */
  readonly ordinal: number
}

export interface ConceptNode {
  readonly concept_id: string
  readonly canonical: string
  readonly aliases: readonly string[]
  readonly definition: string
  readonly kind: ConceptKind
  readonly bloom_target: BloomLevel
  /** 1–5. */
  readonly difficulty: number
  /** 0–1. */
  readonly importance: number
  readonly source_refs: readonly SourceRef[]
}

export interface ConceptEdge {
  readonly from: string
  readonly to: string
  readonly kind: EdgeKind
  /** 0–1. */
  readonly confidence: number
}

export interface KnowledgeGraph {
  readonly nodes: readonly ConceptNode[]
  readonly edges: readonly ConceptEdge[]
}

export interface Objective {
  readonly text: string
  readonly bloom: BloomLevel
}

/** How a lesson spec came to exist, so the preview can label a lesson the code made. */
export type LessonOrigin = 'model' | 'split' | 'merged' | 'catch_up'

export interface LessonSpec {
  readonly title: string
  readonly concept_ids: readonly string[]
  readonly objectives: readonly Objective[]
  /** The model's estimate, 5–20; `null` when the code made the lesson. */
  readonly estimated_minutes: number | null
  readonly origin: LessonOrigin
}

export interface ModuleSpec {
  readonly title: string
  readonly objectives: readonly Objective[]
  readonly lesson_specs: readonly LessonSpec[]
}

export interface SectionSpec {
  readonly title: string
  readonly modules: readonly ModuleSpec[]
}

export interface Misconception {
  readonly concept_id: string
  readonly text: string
  readonly why_wrong: string
}

/** The synthesized outline before validation: what the two P2 calls produced, assembled. */
export interface Outline {
  readonly sections: readonly SectionSpec[]
  readonly misconceptions: readonly Misconception[]
  /** The model's free-text notes, in the path's language. */
  readonly warnings: readonly string[]
}

/** One `chunks` row, as much of it as validation and ordering need. */
export interface ChunkRef {
  readonly chunkId: string
  readonly sourceId: string
  readonly ordinal: number
  readonly headingPath: string | null
  readonly isFrontmatter: boolean
}

/** Keyed by `chunkId`. */
export type ChunkIndex = ReadonlyMap<string, ChunkRef>

export interface LessonLimits {
  readonly conceptsPerLesson: { readonly min: number; readonly max: number }
  readonly objectivesPerLesson: { readonly min: number; readonly max: number }
}

/** `docs/spec/04-path-generation.md` §4, "Activity constraints": 2–5 concepts, 1–3 objectives. */
export const DEFAULT_LESSON_LIMITS: LessonLimits = Object.freeze({
  conceptsPerLesson: Object.freeze({ min: 2, max: 5 }),
  objectivesPerLesson: Object.freeze({ min: 1, max: 3 }),
})

/** QA gate 4 of §5: concepts at or above this importance must be covered. */
export const DEFAULT_IMPORTANCE_THRESHOLD = 0.5

export interface ValidationContext {
  readonly chunks: ChunkIndex
  /** `[primarySourceId, ...others in the configuration's order]` — the source rank. */
  readonly sourceIds: readonly string[]
  readonly importanceThreshold?: number
  readonly limits?: Partial<LessonLimits>
}

export interface ValidatedSynthesis {
  /** Every `PREREQ_OF` cycle broken; no dangling ids, no self-loops, no parallel edges. */
  readonly graph: KnowledgeGraph
  /** Every concept homed in at most one lesson; sizes and objectives within limits. */
  readonly outline: Outline
  readonly warnings: readonly GenerationWarning[]
  /** `outline_empty`: nothing survived to sequence. */
  readonly fatal: GenerationWarning | null
}
