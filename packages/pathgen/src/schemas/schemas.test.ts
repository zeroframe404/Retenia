import { toStrictJsonSchema } from '@retenia/ai'
import { describe, expect, it } from 'vitest'
import { EMPTY_EXTRACTION, EXTRACT_CHUNK_SCHEMA_ID, extractChunkOutputSchema } from './extraction'
import {
  SYNTHESIZE_MODULE_SCHEMA_ID,
  SYNTHESIZE_OUTLINE_SCHEMA_ID,
  synthesizeModuleOutputSchema,
  synthesizeOutlineOutputSchema,
} from './outline'
import { dedupeWarnings, generationWarningSchema, WARNING_CODES, warning } from './warnings'

describe('the AI-facing schemas', () => {
  it.each([
    ['extract_chunk', extractChunkOutputSchema],
    ['synthesize_outline', synthesizeOutlineOutputSchema],
    ['synthesize_module', synthesizeModuleOutputSchema],
  ])('%s exports to a strict-mode JSON Schema', (_, schema) => {
    const json = toStrictJsonSchema(schema) as { type?: string; properties?: object }
    expect(json.type).toBe('object')
    expect(json.properties).toBeDefined()
    expect(JSON.stringify(json)).not.toContain('"$ref"')
  })

  it('name the versions the prompt files declare', () => {
    expect(EXTRACT_CHUNK_SCHEMA_ID).toBe('extract_chunk@1')
    expect(SYNTHESIZE_OUTLINE_SCHEMA_ID).toBe('synthesize_outline@1')
    expect(SYNTHESIZE_MODULE_SCHEMA_ID).toBe('synthesize_module@1')
  })

  it('accept a well-formed extraction and refuse an unknown kind', () => {
    expect(extractChunkOutputSchema.parse(EMPTY_EXTRACTION)).toEqual(EMPTY_EXTRACTION)
    const full = extractChunkOutputSchema.parse({
      concepts: [
        {
          canonical: 'memoria de trabajo',
          aliases: ['MT'],
          definition: 'Sistema de capacidad limitada…',
          kind: 'concept',
          importance: 0.9,
          difficulty: 3,
        },
      ],
      claims: [{ text: 'Retiene 4 ± 1 elementos.', block_ids: ['b1'] }],
      objectives: [{ text: 'Explicar la memoria de trabajo', bloom: 'understand' }],
      prerequisites_mentioned: ['atención'],
      figures: [{ label: 'Figura 3.1', description: 'El modelo de Baddeley' }],
      exercises: [{ text: '¿Cuántos elementos…?', kind: 'question' }],
      is_frontmatter_like: false,
    })
    expect(full.concepts[0]?.kind).toBe('concept')
    expect(() =>
      extractChunkOutputSchema.parse({
        ...EMPTY_EXTRACTION,
        concepts: [{ ...full.concepts[0], kind: 'vibe' }],
      }),
    ).toThrow()
  })

  it('accept a skeleton and a module answer, and refuse an empty outline', () => {
    const skeleton = synthesizeOutlineOutputSchema.parse({
      graph: {
        nodes: [{ concept_id: 'c_1', bloom_target: 'apply', difficulty: 2, importance: 0.8 }],
        edges: [{ from: 'c_1', to: 'c_2', kind: 'PREREQ_OF', confidence: 0.7 }],
      },
      sections: [
        {
          title: 'Bases',
          modules: [{ title: 'Memoria', objectives: [], concept_ids: ['c_1', 'c_2'] }],
        },
      ],
      excluded: [{ heading_path: 'Libro > Apéndice', reason: 'apéndice de tablas' }],
      warnings: [],
    })
    expect(skeleton.sections[0]?.modules[0]?.concept_ids).toEqual(['c_1', 'c_2'])
    expect(() => synthesizeOutlineOutputSchema.parse({ ...skeleton, sections: [] })).toThrow()

    const module = synthesizeModuleOutputSchema.parse({
      lesson_specs: [
        {
          title: 'Uno',
          concept_ids: ['c_1', 'c_2'],
          objectives: [{ text: 'Explicar', bloom: 'understand' }],
          estimated_minutes: 12,
        },
      ],
      misconceptions: [{ concept_id: 'c_1', text: 'x', why_wrong: 'y' }],
      warnings: ['nota'],
    })
    expect(module.lesson_specs).toHaveLength(1)
  })
})

describe('the warning vocabulary', () => {
  it('derives the stage from the code and validates as JSON', () => {
    const entry = warning('cycle_broken', { from: 'a', to: 'b', confidence: 0.2 })
    expect(entry.stage).toBe('validate')
    expect(generationWarningSchema.parse(entry)).toEqual(entry)
    expect(WARNING_CODES).toContain('outline_empty')
    expect(() => generationWarningSchema.parse({ ...entry, code: 'made_up' })).toThrow()
  })

  it('reports the same warning once', () => {
    const one = warning('coverage_gap', { concept_ids: ['a'], lesson: 'L' })
    const same = warning('coverage_gap', { concept_ids: ['a'], lesson: 'L' })
    const other = warning('coverage_gap', { concept_ids: ['b'], lesson: 'L' })
    expect(dedupeWarnings([one, same, other])).toEqual([one, other])
  })
})
