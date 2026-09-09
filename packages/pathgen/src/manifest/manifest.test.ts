import { describe, expect, it } from 'vitest'
import { configHash, parseGenerationConfig } from '../config/generation-config'
import { generationManifestSchema } from '../schemas/manifest'
import { pathDraftSchema } from '../schemas/path-draft'
import { testPrompts } from '../testing/extract-fixtures'
import { MINI_NOW } from '../testing/mini-world'
import { buildPathDraft, draftTitle, misconceptionId } from './build-draft'
import {
  buildManifest,
  chunkSetHash,
  generationSeed,
  SEQUENCING_ALGORITHM_VERSION,
} from './build-manifest'

const config = parseGenerationConfig({
  goal: 'g',
  level: 'l',
  primarySourceId: 'book',
  sourceIds: ['course', 'book'],
})

describe('chunkSetHash() and generationSeed()', () => {
  it('hash the chunk keys as a set, falling back to the hash', () => {
    const a = chunkSetHash([
      { chunkKey: 'k1', hash: 'h1' },
      { chunkKey: null, hash: 'h2' },
    ])
    const b = chunkSetHash([
      { chunkKey: null, hash: 'h2' },
      { chunkKey: 'k1', hash: 'h1' },
    ])
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
    expect(a).not.toBe(chunkSetHash([{ chunkKey: 'k1', hash: 'h1' }]))
  })

  it('seed the shuffles from the inputs, never from anything that changes between runs', () => {
    const seed = generationSeed({
      chunkSetHashes: ['a', 'b'],
      configHash: 'c',
      prompts: testPrompts,
    })
    expect(seed).toBe(
      generationSeed({ chunkSetHashes: ['a', 'b'], configHash: 'c', prompts: testPrompts }),
    )
    expect(seed).not.toBe(
      generationSeed({ chunkSetHashes: ['b', 'a'], configHash: 'c', prompts: testPrompts }),
    )
    expect(seed).not.toBe(
      generationSeed({ chunkSetHashes: ['a', 'b'], configHash: 'd', prompts: testPrompts }),
    )
    expect(seed).not.toBe(
      generationSeed({
        chunkSetHashes: ['a', 'b'],
        configHash: 'c',
        prompts: { ...testPrompts, module: { ...testPrompts.module, promptVersion: '2' } },
      }),
    )
  })
})

describe('buildManifest()', () => {
  it('assembles a valid GenerationManifest.v1 with every version and hash in it', () => {
    const manifest = buildManifest({
      runId: 'run-1',
      createdAt: MINI_NOW,
      stage: 'extracting',
      config,
      configHash: configHash(config),
      sources: [
        {
          source: { id: 'book', blobSha256: 'blob' },
          chunks: [
            { chunkKey: 'k1', hash: 'h1', chunkingVersion: '1:x' },
            { chunkKey: 'k2', hash: 'h2', chunkingVersion: '1:x' },
          ],
        },
        { source: { id: 'course', blobSha256: null }, chunks: [] },
      ],
      prompts: testPrompts,
      models: {
        extract: {
          provider: 'google',
          model: 'gemini',
          temperature: 0,
          modelsUsed: ['b', 'a', 'a'],
        },
        outline: { provider: null, model: null, temperature: 0.3, modelsUsed: [] },
        module: {
          provider: 'anthropic',
          model: 'sonnet',
          temperature: 0.3,
          modelsUsed: ['sonnet'],
        },
      },
      embeddings: { modelId: 'fake', dims: 768, threshold: 0.9 },
      seed: 'seed',
      cost: {
        input_tokens: 1,
        output_tokens: 2,
        cached_tokens: 3,
        usd: 0.4,
        calls: 5,
        cache_hits: 6,
      },
      stats: {
        chunks_total: 2,
        chunks_in_scope: 2,
        chunks_frontmatter: 0,
        chunks_extracted: 1,
        chunks_reused: 1,
        chunks_failed: 0,
        concepts_raw: 4,
        concepts: 3,
        nodes: 3,
        edges: 2,
        sections: 1,
        modules: 1,
        lessons: 2,
      },
      warnings: [
        { code: 'chunk_failed', stage: 'extract', params: { chunk_id: 'c1', error: 'x' } },
        { code: 'chunk_failed', stage: 'extract', params: { chunk_id: 'c1', error: 'x' } },
      ],
    })
    expect(generationManifestSchema.parse(manifest)).toEqual(manifest)
    expect(manifest).toMatchObject({
      version: 1,
      created_at: '2026-09-09T12:00:00.000Z',
      run_id: 'run-1',
      stage: 'extracting',
      config: {
        goal: 'g',
        sourceIds: ['course', 'book'],
        budgetCapUsd: 0,
        lessonLanguage: 'es-AR',
      },
      config_hash: configHash(config),
      prompt_versions: testPrompts.snapshot,
      schema_versions: {
        extract_chunk: 'extract_chunk@1',
        synthesize_outline: 'synthesize_outline@1',
        synthesize_module: 'synthesize_module@1',
        knowledge_graph: 'knowledge_graph@1',
        path_draft: 'path_draft@1',
        manifest: 'generation_manifest@1',
      },
      embeddings: { model_id: 'fake', dims: 768, threshold: 0.9 },
      sequencing: { algorithm_version: SEQUENCING_ALGORITHM_VERSION, seed: 'seed' },
      cost: { usd: 0.4, calls: 5, cache_hits: 6 },
    })
    expect(manifest.source_hashes).toEqual([
      {
        source_id: 'book',
        blob_sha256: 'blob',
        chunk_set_hash: chunkSetHash([
          { chunkKey: 'k1', hash: 'h1' },
          { chunkKey: 'k2', hash: 'h2' },
        ]),
        chunk_count: 2,
        chunking_version: '1:x',
      },
      {
        source_id: 'course',
        blob_sha256: null,
        chunk_set_hash: chunkSetHash([]),
        chunk_count: 0,
        chunking_version: null,
      },
    ])
    expect(manifest.models.P1_extract_chunk).toEqual({
      provider: 'google',
      model: 'gemini',
      temperature: 0,
      seed: null,
      models_used: ['a', 'b'],
    })
    expect(manifest.warnings).toHaveLength(1)
  })
})

describe('buildPathDraft()', () => {
  const sequenced = {
    sections: [],
    final_exam: {
      id: 'FINAL' as const,
      kind: 'final_exam' as const,
      blueprint: { topics: [], item_count: 20 },
      estimated_minutes: 30,
    },
    stats: {
      sections: 0,
      modules: 0,
      lessons: 0,
      checkpoints: 0,
      concepts: 0,
      minutes: 30,
      weeks_estimate: null,
    },
    warnings: [],
  }

  it('names the draft, orders the sources primary first and numbers the misconceptions', () => {
    const draft = buildPathDraft({
      sequenced,
      misconceptions: [
        { concept_id: 'c_a', text: 'x', why_wrong: 'y' },
        { concept_id: 'c_b', text: 'z', why_wrong: 'w' },
      ],
      excluded: [{ heading_path: 'Libro > Apéndice', reason: 'apéndice' }],
      config,
      sources: [
        { id: 'course', title: 'Course' },
        { id: 'book', title: 'Book' },
      ],
      warnings: [
        { code: 'path_too_small', stage: 'sequence', params: { lessons: 0 } },
        { code: 'path_too_small', stage: 'sequence', params: { lessons: 0 } },
      ],
    })
    expect(pathDraftSchema.parse(draft)).toEqual(draft)
    expect(draft).toMatchObject({
      version: 1,
      kind: 'draft',
      title: 'Book',
      language: 'es-AR',
      level: 'l',
      goal: 'g',
      target_date: null,
      sources: [
        { source_id: 'book', title: 'Book', primary: true },
        { source_id: 'course', title: 'Course', primary: false },
      ],
      misconceptions: [
        { id: 'X001', concept_id: 'c_a', text: 'x', why_wrong: 'y' },
        { id: 'X002', concept_id: 'c_b', text: 'z', why_wrong: 'w' },
      ],
      excluded: [{ heading_path: 'Libro > Apéndice', reason: 'apéndice' }],
    })
    expect(draft.warnings).toHaveLength(1)
    expect(misconceptionId(999)).toBe('X1000')
  })

  it('prefers the configured title, and copes with a source it cannot name', () => {
    expect(draftTitle({ ...config, title: 'Mine' }, [])).toBe('Mine')
    expect(draftTitle(config, [])).toBe('Untitled path')
    const draft = buildPathDraft({
      sequenced,
      misconceptions: [],
      excluded: [],
      config: { ...config, forExam: { date: '2026-12-01' } },
      sources: [],
      warnings: [],
    })
    expect(draft.target_date).toBe('2026-12-01')
    expect(draft.sources.map((source) => source.title)).toEqual(['book', 'course'])
  })
})
