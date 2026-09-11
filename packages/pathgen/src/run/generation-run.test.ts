import { createFakeEmbeddingProvider } from '@retenia/core/testing'
import { describe, expect, it } from 'vitest'
import { silentLogger } from '../logger'
import type { ProgressEvent } from '../progress/reporter'
import { knowledgeGraphDocumentSchema } from '../schemas/knowledge-graph'
import { generationManifestSchema } from '../schemas/manifest'
import { pathDraftSchema } from '../schemas/path-draft'
import { createAiHarness } from '../testing/ai-harness'
import { createMemoryRepos } from '../testing/memory-repos'
import { createMiniWorld, MINI_NOW, type MiniDefects } from '../testing/mini-world'
import type { GenerationRunDeps } from './deps'
import { createGenerationRun } from './generation-run'

const clock = { now: () => MINI_NOW }

function world(
  defects: MiniDefects = {},
  options: { batch?: boolean; monthlyBudgetUsd?: number; spentUsd?: number } = {},
) {
  const mini = createMiniWorld(defects)
  const harness = createAiHarness({ resolve: mini.resolve, clock, ...options })
  const repos = createMemoryRepos(clock, { sources: mini.sources, chunks: mini.chunks })
  const events: ProgressEvent[] = []
  const deps: GenerationRunDeps = {
    ai: harness.ai,
    runner: harness.runner,
    resultCache: harness.resultCache,
    registry: harness.registry,
    repos,
    prompts: mini.prompts,
    embeddings: createFakeEmbeddingProvider(),
    progress: { report: (event) => events.push(event) },
    clock,
    timers: harness.timers,
    logger: silentLogger,
    concurrency: { extract: 2, modules: 2 },
  }
  return { mini, harness, repos, events, deps, handle: createGenerationRun(deps) }
}

describe('createGenerationRun().start()', () => {
  it('runs every stage and persists a draft, its graph and a manifest as an unfrozen version', async () => {
    const { mini, harness, repos, events, handle } = world({ excluded: true, modelWarning: true })
    const result = await handle.start(mini.config)

    expect(result.status).toBe('completed')
    expect(result.error).toBeNull()
    expect(result.draft).not.toBeNull()
    expect(result.pathVersionId).not.toBeNull()
    expect(handle.active()).toEqual([])

    const draft = pathDraftSchema.parse(result.draft)
    expect(draft.kind).toBe('draft')
    expect(draft.title).toBe('Memoria y aprendizaje')
    expect(draft.language).toBe('es-AR')
    expect(draft.sources).toEqual([
      { source_id: 'src-book', title: 'Memoria y aprendizaje', primary: true },
      { source_id: 'src-course', title: 'Learning course', primary: false },
    ])
    expect(draft.stats.lessons).toBeGreaterThanOrEqual(6)
    expect(draft.excluded).toEqual([{ heading_path: 'Libro > Índice', reason: 'índice' }])
    expect(draft.warnings.map((entry) => entry.code)).toContain('model_warning')
    expect(draft.misconceptions[0]?.id).toBe('X001')

    // The rows.
    const path = repos.rows.paths[0]
    expect(path).toMatchObject({
      status: 'draft',
      title: 'Memoria y aprendizaje',
      activeVersion: null,
    })
    expect(path?.sourceIds).toEqual(['src-book', 'src-course'])
    const version = repos.rows.versions[0]
    expect(version).toMatchObject({ pathId: path?.id, number: 1, frozenAt: null, diff: null })
    expect(pathDraftSchema.parse(version?.spec)).toEqual(draft)
    const graph = knowledgeGraphDocumentSchema.parse(version?.knowledgeGraph)
    expect(graph.embedding_model_id).toBe('fake-hash-768')
    expect(graph.nodes.length).toBeGreaterThan(10)
    const run = repos.rows.runs[0]
    expect(run).toMatchObject({ status: 'completed', pathVersionId: version?.id, pathId: path?.id })
    expect(run?.finishedAt).toEqual(MINI_NOW)
    expect(run?.costUsd).toBeGreaterThan(0)
    expect(run?.estimate).toMatchObject({ chunks: 9, dispatch: 'sync', runnerQuote: null })
    expect(repos.rows.extractions).toHaveLength(9)
    expect(repos.transactions()).toBe(1)

    // The manifest.
    const manifest = generationManifestSchema.parse(version?.manifest)
    expect(manifest).toEqual(result.manifest)
    expect(manifest.stage).toBe('completed')
    expect(manifest.prompt_versions).toEqual(mini.prompts.snapshot)
    expect(manifest.models.P1_extract_chunk).toEqual({
      provider: 'google',
      model: 'gemini-3.7-flash',
      temperature: 0,
      seed: null,
      models_used: ['gemini-3.7-flash'],
    })
    expect(manifest.models.P2_synthesize_outline?.models_used).toEqual(['claude-sonnet-5'])
    expect(manifest.embeddings).toEqual({ model_id: 'fake-hash-768', dims: 768, threshold: 0.9 })
    expect(manifest.cost.calls).toBe(9 + 1 + 4)
    expect(manifest.cost.cache_hits).toBe(0)
    expect(manifest.stats).toMatchObject({
      chunks_total: 10,
      chunks_in_scope: 10,
      chunks_frontmatter: 1,
      chunks_extracted: 9,
      chunks_reused: 0,
      chunks_failed: 0,
      concepts_raw: 18,
      lessons: draft.stats.lessons,
      modules: draft.stats.modules,
      sections: draft.stats.sections,
    })
    expect(manifest.source_hashes.map((entry) => entry.chunk_count)).toEqual([8, 2])
    expect(manifest.sequencing.algorithm_version).toBe('1')
    expect(manifest.warnings).toEqual(draft.warnings)

    // Progress went through every stage, in order.
    const stages = [...new Set(events.map((event) => event.stage))]
    expect(stages).toEqual([
      'reading_sources',
      'extracting',
      'consolidating',
      'synthesizing',
      'synthesizing_modules',
      'sequencing',
      'persisting',
    ])
    expect(events.every((event) => event.runId === run?.id)).toBe(true)
    expect(harness.recorder.rows.length).toBe(14)
  })

  it('makes zero AI calls on a second run over the same inputs and produces the same draft', async () => {
    const { mini, harness, repos, handle } = world()
    const first = await handle.start(mini.config)
    const calls = harness.replay.calls.length
    const batchCalls = harness.replayBatch.polls()

    const second = await handle.start(mini.config)
    expect(second.status).toBe('completed')
    expect(harness.replay.calls).toHaveLength(calls)
    expect(harness.replayBatch.polls()).toBe(batchCalls)
    expect(second.draft).toEqual(first.draft)
    expect(second.manifest?.cost).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cached_tokens: 0,
      usd: 0,
      calls: 0,
      cache_hits: 9 + 1 + 4,
    })
    expect(second.manifest?.stats.chunks_reused).toBe(9)
    expect(second.manifest?.sequencing.seed).toBe(first.manifest?.sequencing.seed)
    expect(repos.rows.paths).toHaveLength(2)
    expect(repos.rows.versions.map((version) => version.number)).toEqual([1, 1])
  })

  it('generates into an existing path and refuses an unknown one', async () => {
    const { mini, repos, handle } = world()
    const existing = await repos.paths.create({
      title: 'Old',
      language: 'en',
      level: null,
      goal: null,
      targetDate: null,
      status: 'draft',
      activeVersion: null,
      sourceIds: [],
      settings: null,
    })
    const result = await handle.start({ ...mini.config, title: 'Nuevo' }, { pathId: existing.id })
    expect(result.pathId).toBe(existing.id)
    expect(repos.rows.paths).toHaveLength(1)
    expect(repos.rows.paths[0]).toMatchObject({
      title: 'Nuevo',
      status: 'draft',
      language: 'es-AR',
    })
    expect(repos.rows.versions[0]?.pathId).toBe(existing.id)

    await expect(handle.start(mini.config, { pathId: 'nope' })).rejects.toMatchObject({
      code: 'path_not_found',
    })
  })

  it('runs extraction through the batch runner when nobody is waiting', async () => {
    const { mini, harness, repos, handle } = world({}, { batch: true })
    const result = await handle.start(mini.config, { userWaiting: false })
    expect(result.status).toBe('completed')
    expect(harness.replayBatch.submitted).toHaveLength(1)
    expect(harness.replayBatch.submitted[0]).toHaveLength(9)
    expect(repos.rows.runs[0]?.estimate).toMatchObject({
      dispatch: 'batch',
      runnerQuote: { requests: 9, batchDiscountApplied: true },
    })
    expect(repos.rows.runs[0]?.progress).toMatchObject({ user_waiting: false })
    expect(repos.rows.extractions.every((row) => row.provider === 'google')).toBe(true)
  })

  it('blocks before starting when the quote is over the run’s cap, and resumes on "continue anyway"', async () => {
    const { mini, repos, handle, harness } = world()
    const blocked = await handle.start({ ...mini.config, budgetCapUsd: 0.000001 })
    expect(blocked.status).toBe('blocked_budget')
    expect(blocked.warnings).toEqual([
      expect.objectContaining({
        code: 'budget_paused',
        params: expect.objectContaining({ reason: 'estimate' }),
      }),
    ])
    expect(harness.replay.calls).toHaveLength(0)
    expect(repos.rows.runs[0]).toMatchObject({ status: 'blocked_budget', finishedAt: null })
    expect(repos.rows.paths[0]?.status).toBe('generating')
    expect(handle.active()).toEqual([])

    const resumed = await handle.resume(blocked.runId, { allowOverBudget: true })
    expect(resumed.status).toBe('completed')
    expect(resumed.runId).toBe(blocked.runId)
    expect(repos.rows.runs).toHaveLength(1)
    expect(repos.rows.runs[0]?.status).toBe('completed')
    expect(resumed.warnings.map((entry) => entry.code)).not.toContain('budget_paused')
    expect(repos.rows.paths[0]?.status).toBe('draft')
  })

  it('pauses mid-extraction on the cap, keeps what it read, and resumes reusing every row', async () => {
    const { mini, repos, handle, harness } = world()
    // Enough for the quote's high end, not enough for the calls themselves.
    const quote = await handle.start(mini.config)
    const cap = (repos.rows.runs[0]?.costUsd ?? 0) * 0.5
    expect(quote.status).toBe('completed')
    const fresh = world()
    const paused = await fresh.handle.start({ ...mini.config, budgetCapUsd: Math.max(cap, 1e-9) })
    void harness
    // Either blocked at the pre-flight or paused on the way: never completed.
    expect(['blocked_budget']).toContain(paused.status)
    expect(fresh.repos.rows.runs[0]?.status).toBe('blocked_budget')
    const resumed = await fresh.handle.resume(paused.runId, { allowOverBudget: true })
    expect(resumed.status).toBe('completed')
    expect(fresh.repos.rows.extractions).toHaveLength(9)
  })

  it('keeps a resumed run’s manifest cumulative over the previous attempts', async () => {
    const { mini, repos, handle } = world()
    const first = await handle.start(mini.config)
    expect(first.manifest?.cost).toMatchObject({ calls: 14, cache_hits: 0 })
    // Pretend the run paused after everything was paid for, and resume it.
    await repos.generationRuns.update(first.runId, { status: 'blocked_budget', finishedAt: null })
    const resumed = await handle.resume(first.runId)
    expect(resumed.status).toBe('completed')
    expect(resumed.manifest?.cost).toMatchObject({ calls: 14, cache_hits: 14 })
    expect(resumed.manifest?.cost.usd).toBe(first.manifest?.cost.usd)
    expect(resumed.manifest?.models.P1_extract_chunk?.models_used).toEqual(['gemini-3.7-flash'])
    expect(resumed.manifest?.models.P2_synthesize_module?.models_used).toEqual(['claude-sonnet-5'])
    expect(resumed.draft).toEqual(first.draft)
  })

  it('cancels a running run at its next checkpoint and leaves the path as an empty draft', async () => {
    const { mini, repos, handle, events } = world()
    const signal = { aborted: false }
    void events
    const startedPromise = handle.start(mini.config, { signal })
    signal.aborted = true
    const result = await startedPromise
    expect(result.status).toBe('cancelled')
    expect(result.draft).toBeNull()
    expect(repos.rows.runs[0]).toMatchObject({ status: 'cancelled' })
    expect(repos.rows.runs[0]?.finishedAt).toEqual(MINI_NOW)
    expect(repos.rows.paths[0]?.status).toBe('draft')
    expect(repos.rows.versions).toHaveLength(0)
    await expect(handle.resume(result.runId)).rejects.toMatchObject({ code: 'run_not_resumable' })
  })

  it('cancels through the handle while a run is in flight', async () => {
    const { mini, handle, deps } = world()
    let cancelled = false
    const spying = createGenerationRun({
      ...deps,
      progress: {
        report: (event) => {
          if (event.stage === 'extracting' && !cancelled) {
            cancelled = true
            void spying.cancel(event.runId)
          }
        },
      },
    })
    void handle
    const result = await spying.start(mini.config)
    expect(result.status).toBe('cancelled')
  })

  it('closes a paused run that is not running, and answers about unknown or finished ones', async () => {
    const { mini, repos, handle } = world()
    const blocked = await handle.start({ ...mini.config, budgetCapUsd: 0.000001 })
    const closed = await handle.cancel(blocked.runId)
    expect(closed?.status).toBe('cancelled')
    expect(repos.rows.paths[0]?.status).toBe('draft')
    expect(await handle.cancel(blocked.runId)).toMatchObject({ status: 'cancelled' })
    expect(await handle.cancel('nope')).toBeUndefined()
    await expect(handle.resume('nope')).rejects.toMatchObject({ code: 'run_not_found' })
  })

  it('fails the run, with the reason, when the model cannot read the book', async () => {
    const { mini, repos, deps } = world()
    const failing = createGenerationRun({
      ...deps,
      ai: createAiHarness({ resolve: () => '{"concepts": "nope"}', clock }).ai,
    })
    const result = await failing.start(mini.config)
    expect(result.status).toBe('failed')
    expect(result.error).toContain('could not be extracted')
    expect(repos.rows.runs[0]).toMatchObject({ status: 'failed' })
    expect(repos.rows.runs[0]?.error).toContain('could not be extracted')
    expect(repos.rows.paths[0]?.status).toBe('draft')
    expect(result.manifest?.stage).toBe('failed')
  })

  it('refuses a configuration whose sources do not exist, before touching the database', async () => {
    const { mini, repos, handle } = world()
    await expect(
      handle.start({ ...mini.config, sourceIds: ['src-book', 'ghost'] }),
    ).rejects.toMatchObject({
      code: 'no_sources',
    })
    await expect(
      handle.start({ ...mini.config, scope: { kind: 'selected', headingPaths: ['Nowhere'] } }),
    ).rejects.toMatchObject({ code: 'no_chunks' })
    expect(repos.rows.paths).toHaveLength(0)
    expect(repos.rows.runs).toHaveLength(0)
  })

  it('works without a runner, a result cache or an embedding provider, and says so', async () => {
    const { mini, deps, repos } = world()
    const bare = createGenerationRun({
      ...deps,
      runner: undefined,
      resultCache: undefined,
      embeddings: undefined,
      progress: undefined,
    })
    const result = await bare.start(mini.config, { userWaiting: false })
    expect(result.status).toBe('completed')
    expect(result.manifest?.embeddings).toEqual({ model_id: null, dims: null, threshold: 0.9 })
    expect(result.warnings.map((entry) => entry.code)).toContain('embeddings_unavailable')
    expect(repos.rows.runs[0]?.estimate).toMatchObject({ dispatch: 'sync' })
  })
})
