import { describe, expect, it } from 'vitest'
import { configHash, parseGenerationConfig } from '../config/generation-config'
import { buildPathDraft } from '../manifest/build-draft'
import { buildManifest } from '../manifest/build-manifest'
import { toKnowledgeGraphDocument } from '../schemas/knowledge-graph'
import { testPrompts } from '../testing/extract-fixtures'
import { createMemoryRepos } from '../testing/memory-repos'
import { MINI_NOW } from '../testing/mini-world'
import { persistDraft } from './persist-draft'

const clock = { now: () => MINI_NOW }

describe('persistDraft()', () => {
  it('writes the path, its unfrozen version and the completed run in one transaction', async () => {
    const repos = createMemoryRepos(clock)
    const config = parseGenerationConfig({
      goal: 'Aprender',
      level: 'B1',
      primarySourceId: 'book',
      sourceIds: ['course', 'book'],
      forExam: { date: '2026-12-01' },
      title: 'Mi ruta',
    })
    const path = await repos.paths.create({
      title: 'x',
      language: 'en',
      level: null,
      goal: null,
      targetDate: null,
      status: 'generating',
      activeVersion: null,
      sourceIds: [],
      settings: null,
    })
    const run = await repos.generationRuns.create({
      pathId: path.id,
      pathVersionId: null,
      status: 'persisting',
      config: {},
      configHash: configHash(config),
      progress: null,
      estimate: null,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      manifest: null,
      warnings: [],
      error: null,
      startedAt: MINI_NOW,
      finishedAt: null,
    })
    const draft = buildPathDraft({
      sequenced: {
        sections: [],
        final_exam: {
          id: 'FINAL',
          kind: 'final_exam',
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
          weeks_estimate: 1,
        },
        warnings: [],
      },
      misconceptions: [],
      excluded: [],
      config,
      sources: [
        { id: 'book', title: 'Book' },
        { id: 'course', title: 'Course' },
      ],
      warnings: [{ code: 'path_too_small', stage: 'sequence', params: { lessons: 0 } }],
    })
    const manifest = buildManifest({
      runId: run.id,
      createdAt: MINI_NOW,
      stage: 'completed',
      config,
      configHash: configHash(config),
      sources: [],
      prompts: testPrompts,
      models: {
        extract: { provider: null, model: null, temperature: 0, modelsUsed: [] },
        outline: { provider: null, model: null, temperature: 0.3, modelsUsed: [] },
        module: { provider: null, model: null, temperature: 0.3, modelsUsed: [] },
      },
      embeddings: { modelId: null, dims: null, threshold: 0.9 },
      seed: 'seed',
      cost: {
        input_tokens: 10,
        output_tokens: 20,
        cached_tokens: 30,
        usd: 0.5,
        calls: 3,
        cache_hits: 4,
      },
      stats: {
        chunks_total: 0,
        chunks_in_scope: 0,
        chunks_frontmatter: 0,
        chunks_extracted: 0,
        chunks_reused: 0,
        chunks_failed: 0,
        concepts_raw: 0,
        concepts: 0,
        nodes: 0,
        edges: 0,
        sections: 0,
        modules: 0,
        lessons: 0,
      },
      warnings: draft.warnings,
    })

    const persisted = await persistDraft({
      repos,
      runId: run.id,
      pathId: path.id,
      config,
      draft,
      graph: toKnowledgeGraphDocument(
        { nodes: [], edges: [] },
        { embeddingModelId: null, threshold: 0.9 },
      ),
      manifest,
      warnings: draft.warnings,
      cost: manifest.cost,
      now: MINI_NOW,
    })

    expect(repos.transactions()).toBe(1)
    expect(repos.rows.paths[0]).toMatchObject({
      status: 'draft',
      title: 'Mi ruta',
      language: 'es-AR',
      level: 'B1',
      goal: 'Aprender',
      targetDate: '2026-12-01',
      sourceIds: ['book', 'course'],
    })
    expect(repos.rows.paths[0]?.settings).toMatchObject({ goal: 'Aprender', budgetCapUsd: 0 })
    expect(persisted.version).toMatchObject({
      pathId: path.id,
      number: 1,
      frozenAt: null,
      diff: null,
    })
    expect(persisted.version.spec).toEqual(JSON.parse(JSON.stringify(draft)))
    expect(persisted.version.knowledgeGraph).toEqual({
      version: 1,
      embedding_model_id: null,
      threshold: 0.9,
      nodes: [],
      edges: [],
    })
    expect(persisted.version.manifest).toEqual(JSON.parse(JSON.stringify(manifest)))
    expect(persisted.run).toMatchObject({
      status: 'completed',
      pathVersionId: persisted.version.id,
      costUsd: 0.5,
      inputTokens: 10,
      outputTokens: 20,
      cachedTokens: 30,
      finishedAt: MINI_NOW,
      error: null,
    })
    expect(persisted.run.warnings).toEqual([
      { code: 'path_too_small', stage: 'sequence', params: { lessons: 0 } },
    ])
  })
})
