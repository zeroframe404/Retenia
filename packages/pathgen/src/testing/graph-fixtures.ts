import type {
  ChunkIndex,
  ChunkRef,
  ConceptEdge,
  ConceptNode,
  EdgeKind,
  LessonSpec,
  ModuleSpec,
  Outline,
  SectionSpec,
  SourceRef,
  ValidationContext,
} from '../validate/types'

/**
 * Hand-built graphs, chunks and outlines for the validation and sequencing tests. Every
 * builder fills in a plausible default so a test states only what it is about.
 */

export const PRIMARY = 'src-primary'
export const SECONDARY = 'src-secondary'

export function chunk(
  chunkId: string,
  ordinal: number,
  overrides: Partial<ChunkRef> = {},
): ChunkRef {
  return {
    chunkId,
    sourceId: PRIMARY,
    ordinal,
    headingPath: `Libro > ${chunkId}`,
    isFrontmatter: false,
    ...overrides,
  }
}

/** `c0`…`c9` in the primary source, `f0` front matter, `s0`…`s2` in the secondary source. */
export function standardChunks(): ChunkRef[] {
  const out: ChunkRef[] = []
  for (let index = 0; index < 10; index += 1) out.push(chunk(`c${index}`, index))
  out.push(chunk('f0', 0, { isFrontmatter: true, headingPath: 'Libro > Índice' }))
  for (let index = 0; index < 3; index += 1) {
    out.push(chunk(`s${index}`, index, { sourceId: SECONDARY, headingPath: `Curso > ${index}` }))
  }
  return out
}

export function chunkIndex(chunks: readonly ChunkRef[]): ChunkIndex {
  return new Map(chunks.map((entry) => [entry.chunkId, entry]))
}

export function ref(chunkId: string, overrides: Partial<SourceRef> = {}): SourceRef {
  return {
    source_id: PRIMARY,
    chunk_id: chunkId,
    chunk_key: null,
    block_ids: [],
    heading_path: null,
    ordinal: 0,
    ...overrides,
  }
}

export function node(id: string, overrides: Partial<ConceptNode> = {}): ConceptNode {
  return {
    concept_id: id,
    canonical: id.toUpperCase(),
    aliases: [],
    definition: `${id} definition`,
    kind: 'concept',
    bloom_target: 'understand',
    difficulty: 2,
    importance: 0.7,
    source_refs: [ref('c1')],
    ...overrides,
  }
}

/**
 * Where a standard chunk sits, read off its id: `c3` is ordinal 3 of the primary source,
 * `s1` ordinal 1 of the secondary one — the same positions `standardChunks()` declares, so a
 * fixture that bypasses validation still carries real book positions.
 */
export function positionOf(chunkId: string): { source_id: string; ordinal: number } {
  const ordinal = Number.parseInt(chunkId.replace(/^[^0-9]+/, ''), 10)
  return {
    source_id: chunkId.startsWith('s') ? SECONDARY : PRIMARY,
    ordinal: Number.isNaN(ordinal) ? 0 : ordinal,
  }
}

/** A node whose only reference is the chunk named, so its book position is that chunk's. */
export function nodeAt(
  id: string,
  chunkId: string,
  overrides: Partial<ConceptNode> = {},
): ConceptNode {
  return node(id, { source_refs: [ref(chunkId, positionOf(chunkId))], ...overrides })
}

export function edge(
  from: string,
  to: string,
  confidence = 0.8,
  kind: EdgeKind = 'PREREQ_OF',
): ConceptEdge {
  return { from, to, kind, confidence }
}

export function lesson(
  title: string,
  ids: readonly string[],
  overrides: Partial<LessonSpec> = {},
): LessonSpec {
  return {
    title,
    concept_ids: ids,
    objectives: [{ text: `Explicar ${title}`, bloom: 'understand' }],
    estimated_minutes: 10,
    origin: 'model',
    ...overrides,
  }
}

export function moduleSpec(
  title: string,
  lessons: readonly LessonSpec[],
  overrides: Partial<ModuleSpec> = {},
): ModuleSpec {
  return {
    title,
    objectives: [{ text: `Objetivo ${title}`, bloom: 'apply' }],
    lesson_specs: lessons,
    ...overrides,
  }
}

export function section(title: string, modules: readonly ModuleSpec[]): SectionSpec {
  return { title, modules }
}

export function outline(
  sections: readonly SectionSpec[],
  overrides: Partial<Outline> = {},
): Outline {
  return { sections, misconceptions: [], warnings: [], ...overrides }
}

export function context(
  chunks: readonly ChunkRef[] = standardChunks(),
  overrides: Partial<ValidationContext> = {},
): ValidationContext {
  return { chunks: chunkIndex(chunks), sourceIds: [PRIMARY, SECONDARY], ...overrides }
}

/** Every lesson of an outline, in reading order. */
export function allLessons(sections: readonly SectionSpec[]): LessonSpec[] {
  return sections.flatMap((entry) => entry.modules.flatMap((module) => module.lesson_specs))
}
