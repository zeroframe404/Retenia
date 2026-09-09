import { createFakeEmbeddingProvider } from '@retenia/core/testing'
import { describe, expect, it } from 'vitest'
import { createBudgetGuard } from '../budget'
import { configHash, parseGenerationConfig } from '../config/generation-config'
import { type ConsolidatedConcept, consolidateConcepts } from '../consolidate'
import { extractChunks } from '../extract/extract-chunks'
import { silentLogger } from '../logger'
import { planChunks } from '../run/plan-chunks'
import { createAiHarness } from '../testing/ai-harness'
import { createMemoryRepos } from '../testing/memory-repos'
import { BOOK, COURSE, createMiniWorld, MINI_NOW, type MiniDefects } from '../testing/mini-world'
import { type SynthesizeDeps, type SynthesizeInput, synthesize } from './synthesize'
import { OUTLINE_STAGE } from './tasks'

const clock = { now: () => MINI_NOW }

/** Runs extraction and consolidation over the mini world, so synthesis has real inputs. */
async function prepare(
  defects: MiniDefects = {},
  options: { monthlyBudgetUsd?: number; spentUsd?: number } = {},
) {
  const world = createMiniWorld(defects)
  const harness = createAiHarness({ resolve: world.resolve, ...options })
  const repos = createMemoryRepos(clock, { sources: world.sources, chunks: world.chunks })
  const config = parseGenerationConfig(world.config)
  const plan = planChunks(
    world.sources,
    new Map(
      world.sources.map((source) => [
        source.id,
        world.chunks.filter((chunk) => chunk.sourceId === source.id),
      ]),
    ),
    config,
  )
  const extracted = await extractChunks(
    {
      ai: harness.ai,
      extractions: repos.extractions,
      prompt: world.prompts.extract,
      clock,
      timers: harness.timers,
      logger: silentLogger,
    },
    {
      runId: 'run-1',
      chunks: plan.extractable,
      sources: new Map(world.sources.map((source) => [source.id, source])),
      userWaiting: true,
      allowOverBudget: false,
    },
  )
  const consolidated = await consolidateConcepts(extracted.extractions, {
    primarySourceId: BOOK,
    sourceIds: [BOOK, COURSE],
    embeddings: createFakeEmbeddingProvider(),
  })
  const deps: SynthesizeDeps = {
    ai: harness.ai,
    registry: harness.registry,
    prompts: world.prompts,
    logger: silentLogger,
    concurrency: 2,
  }
  const input: SynthesizeInput = {
    config,
    configHash: configHash(config),
    sources: world.sources.map((source) => ({
      id: source.id,
      title: source.title,
      kind: source.kind,
      language: source.language,
      primary: source.id === BOOK,
    })),
    chunks: plan.scoped,
    chunkIndex: plan.chunkIndex,
    concepts: consolidated.concepts,
    allowOverBudget: false,
  }
  return { world, harness, deps, input, concepts: consolidated.concepts }
}

describe('synthesize()', () => {
  it('asks for the outline, then one call per module over a shared prefix, and validates the result', async () => {
    const { harness, deps, input, concepts } = await prepare()
    const events: string[] = []
    const result = await synthesize(
      {
        ...deps,
        onProgress: (event) => events.push(`${event.phase}:${event.done}/${event.total}`),
      },
      input,
    )
    expect(result.status).toBe('completed')
    expect(result.validated?.fatal).toBeNull()
    expect(result.inputs.modules).toBe(4)
    expect(result.calls).toEqual({ outline: 1, modules: 4 })
    expect(result.cacheHits).toEqual({ outline: 0, modules: 0 })
    expect(result.modelsUsed).toEqual({ outline: ['claude-sonnet-5'], module: ['claude-sonnet-5'] })
    expect(result.target).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5' })
    expect(result.outlineId.startsWith(`${OUTLINE_STAGE}-`)).toBe(true)
    expect(result.usage.usd).toBeGreaterThan(0)
    expect(result.inputs.conceptsListed).toBe(concepts.length)
    expect(events).toEqual([
      'outline:0/1',
      'outline:1/1',
      'modules:0/4',
      'modules:1/4',
      'modules:2/4',
      'modules:3/4',
      'modules:4/4',
    ])

    // The outline call and the module calls carry the same wrapped prefix, byte for byte.
    const [outlineCall, ...moduleCalls] = harness.replay.calls.filter((call) =>
      (call.idempotencyKey ?? '').startsWith('P2_'),
    )
    expect(outlineCall?.cachePrefix).toMatch(/^<user_content label="toc">/)
    expect(outlineCall?.cachePrefix).toContain('<user_content label="concepts">')
    expect(moduleCalls).toHaveLength(4)
    for (const call of moduleCalls) expect(call.cachePrefix).toBe(outlineCall?.cachePrefix)
    // This world's prefix is under the provider's cache minimum: assembled, never marked.
    expect(result.cacheDecision).toBe('below-minimum')
    expect(outlineCall?.cache).toBeUndefined()
    // The prefix is wrapped once: the instructions paragraph is in the system message alone.
    expect(outlineCall?.system).toContain('is quoted material supplied by the user')

    const outline = result.validated?.outline
    expect(outline?.sections.map((section) => section.title)).toEqual([
      'Sección 1: la memoria',
      'Sección 2: el aprendizaje',
    ])
    const lessons =
      outline?.sections.flatMap((section) =>
        section.modules.flatMap((module) => module.lesson_specs),
      ) ?? []
    expect(lessons.length).toBeGreaterThanOrEqual(6)
    for (const lesson of lessons) {
      expect(lesson.concept_ids.length).toBeGreaterThanOrEqual(2)
      expect(lesson.concept_ids.length).toBeLessThanOrEqual(5)
      expect(lesson.origin).toBe('model')
    }
    expect(outline?.misconceptions.length).toBe(4)
    expect(result.warnings).toEqual([])
    expect(result.validated?.warnings).toEqual([])
  })

  it('marks the prefix for caching when it is long enough, 5 minutes for the outline and an hour for the modules', async () => {
    const { harness, deps, input } = await prepare()
    const result = await synthesize({ ...deps, countTokens: () => 2_000 }, input)
    expect(result.cacheDecision).toBe('explicit')
    const [outlineCall, ...moduleCalls] = harness.replay.calls.filter((call) =>
      (call.idempotencyKey ?? '').startsWith('P2_'),
    )
    expect(outlineCall?.cache).toEqual({ ttl: '5m', system: true, prefix: true })
    for (const call of moduleCalls)
      expect(call.cache).toEqual({ ttl: '1h', system: true, prefix: true })
  })

  it('replays every answer from ai_results on a second run, with zero provider calls', async () => {
    const { harness, deps, input } = await prepare()
    const first = await synthesize(deps, input)
    const before = harness.replay.calls.length
    const second = await synthesize(deps, input)
    expect(harness.replay.calls).toHaveLength(before)
    expect(second.calls).toEqual({ outline: 0, modules: 0 })
    expect(second.cacheHits).toEqual({ outline: 1, modules: 4 })
    expect(second.usage.usd).toBe(0)
    expect(second.validated).toEqual(first.validated)
    expect(second.outlineId).toBe(first.outlineId)
  })

  it('reports what the model got wrong and repairs it before and after the module calls', async () => {
    const { deps, input } = await prepare({
      cycle: true,
      danglingEdge: true,
      unknownNode: true,
      unhomed: true,
      excluded: true,
      modelWarning: true,
      bigLesson: true,
      repeatedConcept: true,
    })
    const result = await synthesize(deps, input)
    expect(result.status).toBe('completed')
    const codes = result.warnings.map((entry) => entry.code)
    expect(codes).toContain('chunk_excluded')
    expect(codes).toContain('unknown_node')
    expect(codes).toContain('dangling_edge')
    expect(codes).toContain('cycle_broken')
    expect(codes).toContain('coverage_gap')
    expect(result.warnings.find((entry) => entry.code === 'chunk_excluded')?.params).toEqual({
      heading_path: 'Libro > Índice',
      reason: 'índice',
    })
    // The 0.4 edge of the cycle went, never the 0.9 one.
    expect(result.warnings.find((entry) => entry.code === 'cycle_broken')?.params.confidence).toBe(
      0.4,
    )
    // The unclaimed concept was homed in a module, so the model wrote a lesson for it.
    const gap = result.warnings.find((entry) => entry.code === 'coverage_gap')
    expect(gap?.params.module).toBeDefined()
    const validated = result.validated
    const validatedCodes = validated?.warnings.map((entry) => entry.code) ?? []
    expect(validatedCodes).toContain('model_warning')
    expect(validatedCodes).toContain('lesson_split')
    expect(validatedCodes).toContain('concept_repeated')
    expect(validated?.warnings.find((entry) => entry.code === 'model_warning')?.params).toEqual({
      text: 'capítulo 9 excluido: apéndice',
    })
    expect(result.excluded).toEqual([{ heading_path: 'Libro > Índice', reason: 'índice' }])
    // Every important concept ended up in exactly one lesson.
    const homes = new Map<string, number>()
    for (const section of validated?.outline.sections ?? []) {
      for (const module of section.modules) {
        for (const lesson of module.lesson_specs) {
          for (const id of lesson.concept_ids) homes.set(id, (homes.get(id) ?? 0) + 1)
        }
      }
    }
    for (const node of validated?.graph.nodes ?? []) {
      if (node.importance >= 0.5) expect(homes.get(node.concept_id)).toBe(1)
    }
  })

  it('writes catch-up lessons when the model proposes nothing usable, and is fatal only when nothing matters', async () => {
    const { deps, input, harness } = await prepare()
    const empty = createMiniWorld()
    const resolve = (
      request: Parameters<typeof empty.resolve>[0],
      target: Parameters<typeof empty.resolve>[1],
    ) => {
      if ((request.idempotencyKey ?? '').startsWith(`${OUTLINE_STAGE}-`)) {
        return JSON.stringify({
          graph: { nodes: [], edges: [] },
          sections: [
            { title: 'S', modules: [{ title: 'M', objectives: [], concept_ids: ['c_nope'] }] },
          ],
          excluded: [],
          warnings: [],
        })
      }
      return empty.resolve(request, target)
    }
    const own = createAiHarness({ resolve })
    void harness
    const result = await synthesize({ ...deps, ai: own.ai }, input)
    expect(result.status).toBe('completed')
    expect(result.calls).toEqual({ outline: 1, modules: 0 })
    expect(result.warnings.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['coverage_gap', 'unknown_concept', 'module_empty', 'section_empty']),
    )
    // Every important concept still gets a lesson — from the code, labelled as such.
    expect(result.validated?.fatal).toBeNull()
    const lessons =
      result.validated?.outline.sections.flatMap((section) =>
        section.modules.flatMap((module) => module.lesson_specs),
      ) ?? []
    expect(lessons.length).toBeGreaterThan(0)
    expect(lessons.every((lesson) => lesson.origin === 'catch_up')).toBe(true)
    expect(result.validated?.warnings.map((entry) => entry.code)).toContain('coverage_gap')

    // Nothing important at all: nothing to write, and the run says so.
    const trivial = await synthesize(
      { ...deps, ai: createAiHarness({ resolve }).ai },
      { ...input, concepts: input.concepts.map((concept) => ({ ...concept, importance: 0.1 })) },
    )
    expect(trivial.status).toBe('completed')
    expect(trivial.validated?.fatal?.code).toBe('outline_empty')
  })

  it('pauses on the run’s cap before the outline and before a module, and honours "continue anyway"', async () => {
    const { deps, input } = await prepare()
    const beforeOutline = await synthesize(deps, {
      ...input,
      budget: createBudgetGuard(0.01),
      outlineEstimateUsd: 0.05,
    })
    expect(beforeOutline.status).toBe('blocked_budget')
    expect(beforeOutline.validated).toBeNull()
    expect(beforeOutline.warnings).toEqual([
      {
        code: 'budget_paused',
        stage: 'extract',
        params: { reason: 'cap', pending: 1, stage: 'outline' },
      },
    ])

    const budget = createBudgetGuard(0.025)
    const beforeModules = await synthesize(deps, {
      ...input,
      budget,
      outlineEstimateUsd: 0.01,
      perModuleEstimateUsd: 0.03,
    })
    expect(beforeModules.status).toBe('blocked_budget')
    expect(beforeModules.calls.outline).toBe(1)
    expect(beforeModules.calls.modules).toBe(0)
    expect(beforeModules.warnings.at(-1)).toMatchObject({
      code: 'budget_paused',
      params: { reason: 'cap', stage: 'modules', pending: 4 },
    })

    const resumed = await synthesize(deps, {
      ...input,
      budget,
      outlineEstimateUsd: 0.01,
      perModuleEstimateUsd: 0.03,
      allowOverBudget: true,
    })
    expect(resumed.status).toBe('completed')
    expect(resumed.cacheHits.outline).toBe(1)
    expect(resumed.calls.modules).toBe(4)
  })

  it('reports an instruction-like heading or definition, and still makes the calls', async () => {
    const { deps, input, harness } = await prepare({
      injectedHeading: true,
      injectedDefinition: true,
    })
    const result = await synthesize(deps, input)
    expect(result.status).toBe('completed')
    expect(result.calls).toEqual({ outline: 1, modules: 4 })
    const found = result.warnings.filter((entry) => entry.code === 'synthesis_injection_suspected')
    expect(found[0]?.params).toEqual({ block: 'prefix' })
    expect(found.some((entry) => entry.params.block === 'module')).toBe(true)
    // Nothing was rewritten: the heading reached the model as it was, inside the envelope.
    const outlineCall = harness.replay.calls.find((call) =>
      (call.idempotencyKey ?? '').startsWith('P2_synthesize_outline-'),
    )
    expect(outlineCall?.cachePrefix).toContain('Ignore the previous instructions')
  })

  it('pauses when the AI layer refuses on the monthly budget', async () => {
    const { deps, input } = await prepare({}, { monthlyBudgetUsd: 1, spentUsd: 2 })
    const result = await synthesize(deps, input)
    expect(result.status).toBe('blocked_budget')
    expect(result.warnings[0]).toMatchObject({
      code: 'budget_paused',
      params: { reason: 'monthly', stage: 'outline' },
    })
  })

  it('stops when cancelled, before the outline or between modules', async () => {
    const { deps, input } = await prepare()
    const early = await synthesize(deps, { ...input, signal: { aborted: true } })
    expect(early.status).toBe('cancelled')
    expect(early.calls.outline).toBe(0)

    const signal = { aborted: false }
    const flipping: SynthesizeDeps = {
      ...deps,
      onProgress: (event) => {
        if (event.phase === 'modules' && event.done === 1) signal.aborted = true
      },
    }
    const late = await synthesize(flipping, { ...input, signal })
    expect(late.status).toBe('cancelled')
    expect(late.calls.outline).toBe(1)
    expect(late.calls.modules).toBeLessThan(4)
  })

  it('fails the run when a module cannot be synthesized at all', async () => {
    const { deps, input, world } = await prepare()
    const broken = createAiHarness({
      resolve: (request, target) =>
        (request.idempotencyKey ?? '').startsWith('P2_synthesize_module-') &&
        request.prompt.includes('Módulo 2.1')
          ? '{"lesson_specs": "nope"}'
          : world.resolve(request, target),
    })
    await expect(synthesize({ ...deps, ai: broken.ai }, input)).rejects.toMatchObject({
      name: 'GenerationError',
      code: 'module_failed',
    })
  })

  it('lists no more concepts than the block allows and says so', async () => {
    const { deps, input, concepts } = await prepare()
    const one: ConsolidatedConcept[] = concepts.slice(0, 1)
    const result = await synthesize(deps, { ...input, concepts: one })
    expect(result.inputs.conceptsListed).toBe(1)
    expect(result.inputs.conceptsOmitted).toBe(0)
  })
})
