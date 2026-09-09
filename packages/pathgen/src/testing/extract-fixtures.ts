import type { ExtractableChunk, ExtractSource } from '../extract/task'
import type { PathgenPrompt, PathgenPrompts } from '../prompts'
import { EXTRACT_CHUNK_SCHEMA_ID, type ExtractChunkOutput } from '../schemas/extraction'
import { SYNTHESIZE_MODULE_SCHEMA_ID, SYNTHESIZE_OUTLINE_SCHEMA_ID } from '../schemas/outline'

/**
 * Hand-built chunks, sources, prompts and P1 answers for the extraction tests. The real
 * prompt files are loaded by `prompts.test.ts` and by the fixture book; these are short
 * templates with the same shape, so a unit test never reads the disk.
 */

export const BOOK_ID = 'src-book'
export const COURSE_ID = 'src-course'

export const sources: ReadonlyMap<string, ExtractSource> = new Map<string, ExtractSource>([
  [BOOK_ID, { id: BOOK_ID, title: 'Memoria y aprendizaje', kind: 'pdf', language: 'es' }],
  [COURSE_ID, { id: COURSE_ID, title: 'Learning course', kind: 'video', language: 'en' }],
])

export function chunk(
  id: string,
  ordinal: number,
  overrides: Partial<ExtractableChunk> = {},
): ExtractableChunk {
  return {
    id,
    sourceId: BOOK_ID,
    ordinal,
    text: `Texto del fragmento ${id}: la memoria de trabajo tiene capacidad limitada.`,
    hash: `hash-${id}`,
    headingPath: `Libro > Cap. ${ordinal + 1}`,
    context: null,
    chunkKey: `key-${id}`,
    unitId: null,
    locator: { page: ordinal + 1, block_ids: [`${id}-b1`, `${id}-b2`] },
    ...overrides,
  }
}

export const extractPrompt: PathgenPrompt = {
  template: 'Extract concepts from the fragment.\n\n{{task}}',
  promptVersion: '1',
  schemaVersion: EXTRACT_CHUNK_SCHEMA_ID,
  role: 'cheap',
  temperature: 0,
}

export const outlinePrompt: PathgenPrompt = {
  template: 'Propose the outline.\n\n{{task}}',
  promptVersion: '1',
  schemaVersion: SYNTHESIZE_OUTLINE_SCHEMA_ID,
  role: 'smart',
  temperature: 0.3,
}

export const modulePrompt: PathgenPrompt = {
  template: 'Split the module into lessons.\n\n{{task}}',
  promptVersion: '1',
  schemaVersion: SYNTHESIZE_MODULE_SCHEMA_ID,
  role: 'smart',
  temperature: 0.3,
}

export const testPrompts: PathgenPrompts = {
  extract: extractPrompt,
  outline: outlinePrompt,
  module: modulePrompt,
  snapshot: { P1_extract_chunk: '1', P2_synthesize_outline: '1', P2_synthesize_module: '1' },
}

/** A minimal but valid `extract_chunk@1` answer naming the given concepts. */
export function extraction(
  concepts: readonly string[],
  overrides: Partial<ExtractChunkOutput> = {},
): ExtractChunkOutput {
  return {
    concepts: concepts.map((canonical, index) => ({
      canonical,
      aliases: [],
      definition: `Definición de ${canonical}`,
      kind: 'concept',
      importance: 0.9 - index * 0.1,
      difficulty: 2,
    })),
    claims: [],
    objectives: [],
    prerequisites_mentioned: [],
    figures: [],
    exercises: [],
    is_frontmatter_like: false,
    ...overrides,
  }
}

export function extractionJson(
  concepts: readonly string[],
  overrides: Partial<ExtractChunkOutput> = {},
): string {
  return JSON.stringify(extraction(concepts, overrides))
}
