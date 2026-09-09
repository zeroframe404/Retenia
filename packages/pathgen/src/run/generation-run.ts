import type { BatchEstimate, ProviderRole } from '@retenia/ai'
import { approximateTokens, resolveTargets, structuredRequestFor } from '@retenia/ai'
import type {
  AbortSignalLike,
  Chunk,
  GenerationRun,
  GenerationRunStatus,
  JsonObject,
  LearningPath,
  NewEntity,
  Source,
} from '@retenia/core'
import { type BudgetGuard, createBudgetGuard, UNLIMITED_BUDGET } from '../budget'
import type { GenerationConfig, GenerationConfigInput } from '../config/generation-config'
import {
  configHash as hashConfig,
  orderedSourceIds,
  parseGenerationConfig,
} from '../config/generation-config'
import { consolidateConcepts, DEFAULT_THRESHOLD } from '../consolidate'
import { GenerationError } from '../errors'
import {
  estimateGeneration,
  estimateWarnings,
  type GenerationEstimate,
} from '../estimate/estimate-generation'
import { extractChunks, tooManyFailures } from '../extract/extract-chunks'
import { buildExtractRequest, extractBinding, extractCustomId } from '../extract/request'
import type { ExtractSource } from '../extract/task'
import { asJson } from '../json'
import { buildPathDraft } from '../manifest/build-draft'
import { buildManifest, chunkSetHash, generationSeed } from '../manifest/build-manifest'
import type { ProgressDetail } from '../progress/reporter'
import { silentProgress } from '../progress/reporter'
import type { GenerationStage } from '../progress/stages'
import { type PathgenPrompt, systemFor } from '../prompts'
import { extractChunkOutputSchema } from '../schemas/extraction'
import { toKnowledgeGraphDocument } from '../schemas/knowledge-graph'
import {
  type GenerationManifest,
  generationManifestSchema,
  type ManifestStats,
} from '../schemas/manifest'
import { synthesizeModuleOutputSchema, synthesizeOutlineOutputSchema } from '../schemas/outline'
import type { PathDraft } from '../schemas/path-draft'
import {
  dedupeWarnings,
  type GenerationWarning,
  generationWarningSchema,
} from '../schemas/warnings'
import { sequencePath } from '../sequencing/sequence'
import type { TocSource } from '../synthesize/inputs'
import { synthesize } from '../synthesize/synthesize'
import { addUsage, type StageUsage, ZERO_USAGE } from '../usage'
import { DEFAULT_GENERATION_CONCURRENCY, type GenerationRunDeps } from './deps'
import { persistDraft } from './persist-draft'
import { type ChunkPlan, planChunks } from './plan-chunks'

/**
 * The "Generate with AI" run, stages 3–5 of `docs/spec/04-path-generation.md` §3 and the
 * persistence of §3 stage 10, as one orchestrator over ports.
 *
 * `start` creates the path and the run, quotes the work, and walks the stages — extracting →
 * consolidating → synthesizing → sequencing → persisting — writing progress, cost and a
 * partial manifest into `generation_runs` at every boundary. `resume` re-enters a run that
 * paused (`blocked_budget`) or died mid-way: extractions are reused row by row, an in-flight
 * batch is awaited, and every P2 answer replays from `ai_results`, so what was paid for is
 * never paid for again (§7, §13 step 2: "cancellable and resumable"). `cancel` flips the
 * signal of a running run, or closes one that is not running.
 *
 * The main process wires it (sub-phase 8.2) with the same client, runner and result cache
 * every other AI feature uses; nothing here reads a file, a key or a database of its own.
 */

export interface StartOptions {
  /** An existing `paths` row to generate into; a new one is created when absent. */
  readonly pathId?: string
  /** Somebody is watching: synchronous calls with a worker pool. Defaults to `true`. */
  readonly userWaiting?: boolean
  readonly allowOverBudget?: boolean
  readonly signal?: AbortSignalLike
}

export interface ResumeOptions {
  readonly allowOverBudget?: boolean
  readonly signal?: AbortSignalLike
}

export interface GenerationResult {
  readonly runId: string
  readonly pathId: string
  readonly pathVersionId: string | null
  readonly status: GenerationRunStatus
  readonly manifest: GenerationManifest | null
  readonly warnings: GenerationWarning[]
  readonly draft: PathDraft | null
  readonly error: string | null
}

export interface GenerationRunHandle {
  start(config: GenerationConfigInput, options?: StartOptions): Promise<GenerationResult>
  resume(runId: string, options?: ResumeOptions): Promise<GenerationResult>
  /**
   * Stops a running run at its next checkpoint, or closes a paused one outright. Returns the
   * row as it stands; a running run's row moves once its stage notices.
   */
  cancel(runId: string): Promise<GenerationRun | undefined>
  /** The ids of the runs this handle is currently executing. */
  active(): string[]
}

const TERMINAL: ReadonlySet<GenerationRunStatus> = new Set<GenerationRunStatus>([
  'completed',
  'failed',
  'cancelled',
])

const EMPTY_STATS: ManifestStats = Object.freeze({
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
})

interface Target {
  readonly provider: string
  readonly model: string
}

interface Attempt {
  run: GenerationRun
  readonly path: LearningPath
  readonly config: GenerationConfig
  readonly configHash: string
  readonly plan: ChunkPlan
  readonly userWaiting: boolean
  readonly allowOverBudget: boolean
  readonly signal: AbortSignalLike
  readonly budget: BudgetGuard
  readonly estimate: GenerationEstimate
  readonly targets: { readonly cheap: Target | null; readonly smart: Target | null }
  readonly seed: string
  readonly batchIds: string[]
  readonly warnings: GenerationWarning[]
  usage: StageUsage
  calls: number
  cacheHits: number
  readonly models: { extract: string[]; outline: string[]; module: string[] }
  stats: ManifestStats
  embeddingModelId: string | null
}

/** `generation_runs.error` is a column and crosses IPC: bounded like every stored error. */
export const MAX_RUN_ERROR_CHARS = 500

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > MAX_RUN_ERROR_CHARS ? `${text.slice(0, MAX_RUN_ERROR_CHARS - 1)}…` : text
}

/** `progress.batch_ids` and friends, read back defensively: the column is JSON. */
function readProgress(run: GenerationRun): { batchIds: string[]; userWaiting: boolean } {
  const progress = run.progress ?? {}
  const ids = progress.batch_ids
  return {
    batchIds: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
    userWaiting: progress.user_waiting !== false,
  }
}

/** What the previous attempts already counted, so the manifest stays cumulative. */
function readAccounting(run: GenerationRun): {
  calls: number
  cacheHits: number
  models: { extract: string[]; outline: string[]; module: string[] }
} {
  const parsed = generationManifestSchema.safeParse(run.manifest)
  if (!parsed.success) {
    return { calls: 0, cacheHits: 0, models: { extract: [], outline: [], module: [] } }
  }
  const manifest = parsed.data
  return {
    calls: manifest.cost.calls,
    cacheHits: manifest.cost.cache_hits,
    models: {
      extract: [...manifest.models.P1_extract_chunk.models_used],
      outline: [...manifest.models.P2_synthesize_outline.models_used],
      module: [...manifest.models.P2_synthesize_module.models_used],
    },
  }
}

function readWarnings(run: GenerationRun): GenerationWarning[] {
  const out: GenerationWarning[] = []
  for (const entry of run.warnings) {
    const parsed = generationWarningSchema.safeParse(entry)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

export function createGenerationRun(deps: GenerationRunDeps): GenerationRunHandle {
  const progressSink = deps.progress ?? silentProgress
  const concurrency = { ...DEFAULT_GENERATION_CONCURRENCY, ...deps.concurrency }
  const countTokens = deps.countTokens ?? approximateTokens
  const sequencer = deps.sequencer ?? sequencePath
  const active = new Map<string, { aborted: boolean }>()

  const resolveTarget = async (role: ProviderRole): Promise<Target | null> => {
    try {
      const [target] = resolveTargets(role, await deps.registry())
      return target === undefined ? null : { provider: target.profile.id, model: target.modelId }
    } catch {
      return null
    }
  }

  const systemTokensOf = (
    prompt: PathgenPrompt,
    schema: Parameters<typeof structuredRequestFor>[0]['schema'],
  ): number =>
    countTokens(
      structuredRequestFor({
        system: systemFor(prompt.template),
        prompt: '',
        temperature: 0,
        schema,
      }).system ?? '',
    )

  const quote = async (
    plan: ChunkPlan,
    userWaiting: boolean,
    alreadyExtracted: number,
  ): Promise<GenerationEstimate> => {
    const [cheap, smart] = await Promise.all([deps.ai.ratesFor('cheap'), deps.ai.ratesFor('smart')])
    return estimateGeneration({
      chunks: plan.extractable,
      alreadyExtracted,
      rates: {
        ...(cheap === undefined ? {} : { cheap }),
        ...(smart === undefined ? {} : { smart }),
      },
      systemTokens: {
        extract: systemTokensOf(deps.prompts.extract, extractChunkOutputSchema),
        outline: systemTokensOf(deps.prompts.outline, synthesizeOutlineOutputSchema),
        module: systemTokensOf(deps.prompts.module, synthesizeModuleOutputSchema),
      },
      dispatch: !userWaiting && deps.runner !== undefined ? 'batch' : 'sync',
      countTokens,
      concurrency,
    })
  }

  /**
   * The batch runner's own quote for the P1 requests that would go through it — the exact
   * figure, stored beside the wizard's estimate so the two can be compared afterwards.
   */
  const batchQuote = async (
    chunks: readonly Chunk[],
    sources: readonly Source[],
    userWaiting: boolean,
  ): Promise<BatchEstimate | null> => {
    if (userWaiting || deps.runner === undefined || chunks.length === 0) return null
    const system = systemFor(deps.prompts.extract.template)
    const byId = new Map(sources.map((source) => [source.id, source]))
    const requests = chunks.map(
      (chunk) =>
        buildExtractRequest(chunk, byId.get(chunk.sourceId) as Source, deps.prompts.extract, {
          system,
        }).batch,
    )
    try {
      return await deps.runner.estimate(extractBinding(deps.prompts.extract), requests)
    } catch (error) {
      deps.logger.warn(
        `[pathgen] the batch runner could not quote the extraction: ${errorMessage(error)}`,
      )
      return null
    }
  }

  const loadPlan = async (config: GenerationConfig): Promise<ChunkPlan> => {
    const ids = orderedSourceIds(config)
    const sources = await deps.repos.sources.findMany(ids)
    const found = new Set(sources.map((source) => source.id))
    const missing = ids.filter((id) => !found.has(id))
    if (missing.length > 0) {
      throw new GenerationError('no_sources', `no source found for ${missing.join(', ')}`)
    }
    const chunksBySource = new Map<string, readonly Chunk[]>()
    for (const source of sources) {
      chunksBySource.set(source.id, await deps.repos.chunks.listBySource(source.id))
    }
    const plan = planChunks(sources, chunksBySource, config)
    if (plan.extractable.length === 0) {
      throw new GenerationError(
        'no_chunks',
        'nothing to read: every chunk is front matter or out of scope',
      )
    }
    return plan
  }

  const manifestOf = (attempt: Attempt, stage: GenerationRunStatus): GenerationManifest =>
    buildManifest({
      runId: attempt.run.id,
      createdAt: deps.clock.now(),
      stage,
      config: attempt.config,
      configHash: attempt.configHash,
      sources: attempt.plan.sources.map((source) => ({
        source,
        chunks: attempt.plan.scoped.filter((chunk) => chunk.sourceId === source.id),
      })),
      prompts: deps.prompts,
      models: {
        extract: {
          provider: attempt.targets.cheap?.provider ?? null,
          model: attempt.targets.cheap?.model ?? null,
          temperature: deps.prompts.extract.temperature,
          modelsUsed: attempt.models.extract,
        },
        outline: {
          provider: attempt.targets.smart?.provider ?? null,
          model: attempt.targets.smart?.model ?? null,
          temperature: deps.prompts.outline.temperature,
          modelsUsed: attempt.models.outline,
        },
        module: {
          provider: attempt.targets.smart?.provider ?? null,
          model: attempt.targets.smart?.model ?? null,
          temperature: deps.prompts.module.temperature,
          modelsUsed: attempt.models.module,
        },
      },
      embeddings: {
        modelId: attempt.embeddingModelId,
        dims: deps.embeddings?.dims ?? null,
        threshold: DEFAULT_THRESHOLD,
      },
      seed: attempt.seed,
      cost: {
        input_tokens: attempt.usage.inputTokens,
        output_tokens: attempt.usage.outputTokens,
        cached_tokens: attempt.usage.cachedTokens,
        usd: attempt.usage.usd,
        calls: attempt.calls,
        cache_hits: attempt.cacheHits,
      },
      stats: attempt.stats,
      warnings: attempt.warnings,
    })

  const progressDoc = (
    attempt: Attempt,
    stage: GenerationStage,
    done: number,
    total: number,
  ): JsonObject => ({
    stage,
    done,
    total,
    batch_ids: [...attempt.batchIds],
    user_waiting: attempt.userWaiting,
  })

  const report = (
    attempt: Attempt,
    stage: GenerationStage,
    done: number,
    total: number,
    detail?: ProgressDetail,
  ): void => {
    progressSink.report({
      runId: attempt.run.id,
      stage,
      done,
      total,
      at: deps.clock.now(),
      ...(detail === undefined ? {} : { detail }),
    })
  }

  /** A stage boundary: the status, the progress and a partial manifest, in one write. */
  const checkpoint = async (
    attempt: Attempt,
    status: GenerationRunStatus,
    stage: GenerationStage,
    done: number,
    total: number,
  ): Promise<void> => {
    attempt.run = await deps.repos.generationRuns.update(attempt.run.id, {
      status,
      progress: progressDoc(attempt, stage, done, total),
      manifest: asJson(manifestOf(attempt, status)),
      warnings: dedupeWarnings(attempt.warnings).map((entry) => asJson(entry)),
      costUsd: attempt.usage.usd,
      inputTokens: attempt.usage.inputTokens,
      outputTokens: attempt.usage.outputTokens,
      cachedTokens: attempt.usage.cachedTokens,
    })
  }

  const finish = async (
    attempt: Attempt,
    status: Exclude<GenerationRunStatus, 'completed'>,
    stage: GenerationStage,
    error: string | null,
  ): Promise<GenerationResult> => {
    const terminal = TERMINAL.has(status)
    const manifest = manifestOf(attempt, status)
    attempt.run = await deps.repos.generationRuns.update(attempt.run.id, {
      status,
      progress: attempt.run.progress ?? progressDoc(attempt, stage, 0, 0),
      manifest: asJson(manifest),
      warnings: manifest.warnings.map((entry) => asJson(entry)),
      costUsd: attempt.usage.usd,
      inputTokens: attempt.usage.inputTokens,
      outputTokens: attempt.usage.outputTokens,
      cachedTokens: attempt.usage.cachedTokens,
      error,
      ...(terminal ? { finishedAt: deps.clock.now() } : {}),
    })
    if (terminal) {
      // The path stays, as an empty draft the user can retry into or discard.
      await deps.repos.paths.update(attempt.path.id, { status: 'draft' })
    }
    return {
      runId: attempt.run.id,
      pathId: attempt.path.id,
      pathVersionId: null,
      status,
      manifest,
      warnings: manifest.warnings,
      draft: null,
      error,
    }
  }

  const execute = async (attempt: Attempt): Promise<GenerationResult> => {
    const runId = attempt.run.id
    const sourceIds = orderedSourceIds(attempt.config)
    const budgetPaused = (stage: GenerationStage): Promise<GenerationResult> =>
      finish(attempt, 'blocked_budget', stage, null)
    const cancelled = (stage: GenerationStage): Promise<GenerationResult> =>
      finish(attempt, 'cancelled', stage, null)

    // --- extracting ------------------------------------------------------------------------
    await checkpoint(attempt, 'extracting', 'reading_sources', 0, attempt.plan.sources.length)
    report(attempt, 'reading_sources', attempt.plan.sources.length, attempt.plan.sources.length)
    const sources = new Map<string, ExtractSource>(
      attempt.plan.sources.map((source) => [source.id, source]),
    )
    const perCall =
      attempt.estimate.p1.calls > 0 ? attempt.estimate.p1.usd / attempt.estimate.p1.calls : 0
    let sinceProgressWrite = 0
    const extracted = await extractChunks(
      {
        ai: deps.ai,
        ...(deps.runner === undefined ? {} : { runner: deps.runner }),
        ...(deps.resultCache === undefined ? {} : { resultCache: deps.resultCache }),
        extractions: deps.repos.extractions,
        prompt: deps.prompts.extract,
        clock: deps.clock,
        timers: deps.timers,
        logger: deps.logger,
        concurrency: concurrency.extract,
        onProgress: (progress) => {
          report(attempt, 'extracting', progress.done, progress.total, {
            cached: progress.reused,
            usdSoFar: attempt.usage.usd,
            ...(progress.batchId === undefined ? {} : { batchId: progress.batchId }),
          })
          sinceProgressWrite += 1
          if (sinceProgressWrite >= 10) {
            sinceProgressWrite = 0
            void deps.repos.generationRuns
              .update(runId, {
                progress: progressDoc(attempt, 'extracting', progress.done, progress.total),
              })
              .catch((error: unknown) =>
                deps.logger.error('[pathgen] could not save progress', error),
              )
          }
        },
        onBatch: async (batchId) => {
          attempt.batchIds.push(batchId)
          attempt.run = await deps.repos.generationRuns.update(runId, {
            progress: progressDoc(attempt, 'extracting', 0, attempt.plan.extractable.length),
          })
        },
      },
      {
        runId,
        chunks: attempt.plan.extractable,
        sources,
        userWaiting: attempt.userWaiting,
        allowOverBudget: attempt.allowOverBudget,
        budget: attempt.budget,
        perCallEstimateUsd: perCall,
        batchIds: [...attempt.batchIds],
        signal: attempt.signal,
      },
    )
    attempt.warnings.push(...extracted.warnings)
    attempt.usage = addUsage(attempt.usage, extracted.usage)
    attempt.calls += extracted.calls
    attempt.cacheHits += extracted.reused + extracted.cacheHits
    attempt.models.extract.push(...extracted.modelsUsed)
    attempt.stats = {
      ...attempt.stats,
      chunks_extracted: extracted.extracted + extracted.cacheHits,
      chunks_reused: extracted.reused,
      chunks_failed: extracted.failed.length,
      concepts_raw: extracted.extractions.reduce(
        (sum, entry) => sum + entry.output.concepts.length,
        0,
      ),
    }
    if (extracted.status === 'cancelled') return cancelled('extracting')
    if (extracted.status === 'blocked_budget') return budgetPaused('extracting')
    if (tooManyFailures(extracted)) {
      throw new GenerationError(
        'too_many_chunk_failures',
        `${extracted.failed.length} of ${extracted.failed.length + extracted.extracted} chunks could not be extracted`,
      )
    }
    if (extracted.extractions.length === 0) {
      throw new GenerationError('no_chunks', 'no chunk could be extracted')
    }

    // --- consolidating ---------------------------------------------------------------------
    await checkpoint(attempt, 'consolidating', 'consolidating', 0, 1)
    report(attempt, 'consolidating', 0, 1, { concepts: attempt.stats.concepts_raw })
    const consolidated = await consolidateConcepts(extracted.extractions, {
      primarySourceId: attempt.config.primarySourceId,
      sourceIds,
      ...(deps.embeddings === undefined ? {} : { embeddings: deps.embeddings }),
    })
    attempt.warnings.push(...consolidated.warnings)
    attempt.embeddingModelId = consolidated.embeddingModelId
    attempt.stats = { ...attempt.stats, concepts: consolidated.concepts.length }
    report(attempt, 'consolidating', 1, 1, { concepts: consolidated.concepts.length })
    if (attempt.signal.aborted) return cancelled('consolidating')

    // --- synthesizing ----------------------------------------------------------------------
    await checkpoint(attempt, 'synthesizing', 'synthesizing', 0, 1)
    const tocSources: TocSource[] = attempt.plan.sources.map((source: Source) => ({
      id: source.id,
      title: source.title,
      kind: source.kind,
      language: source.language,
      primary: source.id === attempt.config.primarySourceId,
    }))
    const perModule =
      attempt.estimate.p2Modules.calls > 0
        ? attempt.estimate.p2Modules.usd / attempt.estimate.p2Modules.calls
        : 0
    const synthesized = await synthesize(
      {
        ai: deps.ai,
        registry: deps.registry,
        prompts: deps.prompts,
        countTokens,
        logger: deps.logger,
        concurrency: concurrency.modules,
        onProgress: (progress) => {
          if (progress.phase === 'outline') {
            report(attempt, 'synthesizing', progress.done, progress.total, {
              concepts: consolidated.concepts.length,
            })
          } else {
            report(attempt, 'synthesizing_modules', progress.done, progress.total)
          }
        },
      },
      {
        config: attempt.config,
        configHash: attempt.configHash,
        sources: tocSources,
        chunks: attempt.plan.scoped,
        chunkIndex: attempt.plan.chunkIndex,
        concepts: consolidated.concepts,
        allowOverBudget: attempt.allowOverBudget,
        budget: attempt.budget,
        outlineEstimateUsd: attempt.estimate.p2Outline.usd,
        perModuleEstimateUsd: perModule,
        signal: attempt.signal,
      },
    )
    attempt.warnings.push(...synthesized.warnings)
    attempt.usage = addUsage(attempt.usage, synthesized.usage)
    attempt.calls += synthesized.calls.outline + synthesized.calls.modules
    attempt.cacheHits += synthesized.cacheHits.outline + synthesized.cacheHits.modules
    attempt.models.outline.push(...synthesized.modelsUsed.outline)
    attempt.models.module.push(...synthesized.modelsUsed.module)
    if (synthesized.cacheDecision === 'below-minimum') {
      deps.logger.warn(
        '[pathgen] the P2 prefix is below the provider’s cache minimum; no discount will apply',
      )
    }
    if (synthesized.status === 'cancelled') return cancelled('synthesizing')
    if (synthesized.status === 'blocked_budget') return budgetPaused('synthesizing')
    const validated = synthesized.validated
    if (validated === null) throw new Error('[pathgen] synthesis completed without a result')
    attempt.warnings.push(...validated.warnings)
    attempt.stats = {
      ...attempt.stats,
      nodes: validated.graph.nodes.length,
      edges: validated.graph.edges.length,
      modules: synthesized.inputs.modules,
    }
    if (validated.fatal !== null) {
      attempt.warnings.push(validated.fatal)
      throw new GenerationError('outline_empty', 'nothing survived validation to sequence')
    }
    if (attempt.signal.aborted) return cancelled('synthesizing')

    // --- sequencing ------------------------------------------------------------------------
    await checkpoint(attempt, 'sequencing', 'sequencing', 0, 1)
    report(attempt, 'sequencing', 0, 1)
    const sequenced = sequencer(
      validated,
      {
        primarySourceId: attempt.config.primarySourceId,
        sourceIds,
        paceHoursPerWeek: attempt.config.paceHoursPerWeek,
        forExam: attempt.config.forExam,
      },
      { seed: attempt.seed, now: deps.clock.now() },
    )
    attempt.warnings.push(...sequenced.draft.warnings)
    attempt.stats = {
      ...attempt.stats,
      sections: sequenced.draft.stats.sections,
      modules: sequenced.draft.stats.modules,
      lessons: sequenced.draft.stats.lessons,
    }
    report(attempt, 'sequencing', 1, 1)
    if (attempt.signal.aborted) return cancelled('sequencing')

    // --- persisting ------------------------------------------------------------------------
    await checkpoint(attempt, 'persisting', 'persisting', 0, 1)
    report(attempt, 'persisting', 0, 1)
    const warnings = dedupeWarnings(attempt.warnings)
    const draft = buildPathDraft({
      sequenced: sequenced.draft,
      misconceptions: validated.outline.misconceptions,
      excluded: synthesized.excluded,
      config: attempt.config,
      sources: attempt.plan.sources,
      warnings,
    })
    const manifest = manifestOf(attempt, 'completed')
    const persisted = await persistDraft({
      repos: deps.repos,
      runId,
      pathId: attempt.path.id,
      config: attempt.config,
      draft,
      graph: toKnowledgeGraphDocument(sequenced.graph, {
        embeddingModelId: attempt.embeddingModelId,
        threshold: DEFAULT_THRESHOLD,
      }),
      manifest,
      warnings,
      cost: manifest.cost,
      now: deps.clock.now(),
    })
    attempt.run = persisted.run
    report(attempt, 'persisting', 1, 1)

    return {
      runId,
      pathId: attempt.path.id,
      pathVersionId: persisted.version.id,
      status: 'completed',
      manifest,
      warnings,
      draft,
      error: null,
    }
  }

  const run = async (attempt: Attempt): Promise<GenerationResult> => {
    try {
      return await execute(attempt)
    } catch (error) {
      if (attempt.signal.aborted) return finish(attempt, 'cancelled', 'extracting', null)
      deps.logger.error(`[pathgen] generation run ${attempt.run.id} failed`, error)
      return finish(attempt, 'failed', 'extracting', errorMessage(error))
    } finally {
      active.delete(attempt.run.id)
    }
  }

  const compose = (
    runId: string,
    outer: AbortSignalLike | undefined,
  ): { signal: AbortSignalLike; controller: { aborted: boolean } } => {
    const controller = { aborted: false }
    active.set(runId, controller)
    return {
      controller,
      signal: {
        get aborted() {
          return controller.aborted || outer?.aborted === true
        },
      },
    }
  }

  const start: GenerationRunHandle['start'] = async (input, options = {}) => {
    const config = parseGenerationConfig(input)
    const configHash = hashConfig(config)
    const userWaiting = options.userWaiting ?? true
    const allowOverBudget = options.allowOverBudget === true
    const plan = await loadPlan(config)
    const now = deps.clock.now()

    const primary = plan.sources.find((source) => source.id === config.primarySourceId)
    const title = config.title ?? primary?.title ?? 'Untitled path'
    const pathFields: Omit<NewEntity<LearningPath>, 'status' | 'activeVersion'> = {
      title,
      language: config.lessonLanguage,
      level: config.level,
      goal: config.goal,
      targetDate: config.forExam === null ? null : config.forExam.date,
      sourceIds: orderedSourceIds(config),
      settings: asJson(config),
    }
    let path: LearningPath
    if (options.pathId === undefined) {
      path = await deps.repos.paths.create({
        ...pathFields,
        status: 'generating',
        activeVersion: null,
      })
    } else {
      const existing = await deps.repos.paths.findById(options.pathId)
      if (existing === undefined) {
        throw new GenerationError('path_not_found', `no path ${options.pathId}`)
      }
      path = await deps.repos.paths.update(existing.id, { ...pathFields, status: 'generating' })
    }

    const [estimate, runnerQuote, cheap, smart] = await Promise.all([
      quote(plan, userWaiting, 0),
      batchQuote(plan.extractable, plan.sources, userWaiting),
      resolveTarget('cheap'),
      resolveTarget('smart'),
    ])
    const seed = generationSeed({
      chunkSetHashes: plan.sources.map((source) =>
        chunkSetHash(plan.scoped.filter((chunk) => chunk.sourceId === source.id)),
      ),
      configHash,
      prompts: deps.prompts,
    })
    const created = await deps.repos.generationRuns.create({
      pathId: path.id,
      pathVersionId: null,
      status: 'queued',
      config: asJson(config),
      configHash,
      progress: {
        stage: 'reading_sources',
        done: 0,
        total: plan.sources.length,
        batch_ids: [],
        user_waiting: userWaiting,
      },
      estimate: asJson({ ...estimate, runnerQuote }),
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      manifest: null,
      warnings: [],
      error: null,
      startedAt: now,
      finishedAt: null,
    })
    const { signal } = compose(created.id, options.signal)

    const attempt: Attempt = {
      run: created,
      path,
      config,
      configHash,
      plan,
      userWaiting,
      allowOverBudget,
      signal,
      budget: allowOverBudget ? UNLIMITED_BUDGET : createBudgetGuard(config.budgetCapUsd),
      estimate,
      targets: { cheap, smart },
      seed,
      batchIds: [],
      warnings: estimateWarnings(estimate, config.budgetCapUsd),
      usage: ZERO_USAGE,
      calls: 0,
      cacheHits: 0,
      models: { extract: [], outline: [], module: [] },
      stats: {
        ...EMPTY_STATS,
        chunks_total: plan.total,
        chunks_in_scope: plan.scoped.length,
        chunks_frontmatter: plan.frontmatter,
      },
      embeddingModelId: null,
    }

    // The pre-flight gate: the quote's high end against the run's own cap.
    if (config.budgetCapUsd > 0 && estimate.highUsd > config.budgetCapUsd && !allowOverBudget) {
      attempt.warnings.push({
        code: 'budget_paused',
        stage: 'extract',
        params: {
          reason: 'estimate',
          pending: plan.extractable.length,
          estimate_usd: Math.round(estimate.highUsd * 100) / 100,
          cap_usd: config.budgetCapUsd,
        },
      })
      active.delete(created.id)
      return finish(attempt, 'blocked_budget', 'reading_sources', null)
    }

    return run(attempt)
  }

  const resume: GenerationRunHandle['resume'] = async (runId, options = {}) => {
    const existing = await deps.repos.generationRuns.findById(runId)
    if (existing === undefined)
      throw new GenerationError('run_not_found', `no generation run ${runId}`)
    if (TERMINAL.has(existing.status)) {
      throw new GenerationError('run_not_resumable', `run ${runId} is ${existing.status}`)
    }
    if (active.has(runId)) {
      throw new GenerationError('run_not_resumable', `run ${runId} is already running`)
    }
    const path = await deps.repos.paths.findById(existing.pathId)
    if (path === undefined)
      throw new GenerationError('path_not_found', `no path ${existing.pathId}`)

    const config = parseGenerationConfig(existing.config)
    const configHash = hashConfig(config)
    const plan = await loadPlan(config)
    const previous = readProgress(existing)
    const allowOverBudget = options.allowOverBudget === true
    const stored = new Set(
      (
        await deps.repos.extractions.findByCustomIds(
          plan.extractable.map((chunk) => extractCustomId(chunk, deps.prompts.extract)),
        )
      ).map((row) => row.customId),
    )
    const pending = plan.extractable.filter(
      (chunk) => !stored.has(extractCustomId(chunk, deps.prompts.extract)),
    )
    const [estimate, runnerQuote, cheap, smart] = await Promise.all([
      quote(plan, previous.userWaiting, plan.extractable.length - pending.length),
      batchQuote(pending, plan.sources, previous.userWaiting),
      resolveTarget('cheap'),
      resolveTarget('smart'),
    ])
    const usage: StageUsage = {
      inputTokens: existing.inputTokens,
      outputTokens: existing.outputTokens,
      cachedTokens: existing.cachedTokens,
      usd: existing.costUsd,
    }
    await deps.repos.paths.update(path.id, { status: 'generating' })
    const accounting = readAccounting(existing)
    existing.estimate = asJson({ ...estimate, runnerQuote })
    await deps.repos.generationRuns.update(runId, { estimate: existing.estimate })
    const { signal } = compose(runId, options.signal)

    const attempt: Attempt = {
      run: existing,
      path,
      config,
      configHash,
      plan,
      userWaiting: previous.userWaiting,
      allowOverBudget,
      signal,
      budget: allowOverBudget
        ? UNLIMITED_BUDGET
        : createBudgetGuard(config.budgetCapUsd, existing.costUsd),
      estimate,
      targets: { cheap, smart },
      seed: generationSeed({
        chunkSetHashes: plan.sources.map((source) =>
          chunkSetHash(plan.scoped.filter((chunk) => chunk.sourceId === source.id)),
        ),
        configHash,
        prompts: deps.prompts,
      }),
      batchIds: previous.batchIds,
      // The cap and the pause that raised it belong to the previous attempt.
      warnings: readWarnings(existing).filter((entry) => entry.code !== 'budget_paused'),
      usage,
      calls: accounting.calls,
      cacheHits: accounting.cacheHits,
      models: accounting.models,
      stats: {
        ...EMPTY_STATS,
        chunks_total: plan.total,
        chunks_in_scope: plan.scoped.length,
        chunks_frontmatter: plan.frontmatter,
      },
      embeddingModelId: null,
    }
    return run(attempt)
  }

  const cancel: GenerationRunHandle['cancel'] = async (runId) => {
    const controller = active.get(runId)
    if (controller !== undefined) {
      controller.aborted = true
      return deps.repos.generationRuns.findById(runId)
    }
    const existing = await deps.repos.generationRuns.findById(runId)
    if (existing === undefined || TERMINAL.has(existing.status)) return existing
    const cancelledRun = await deps.repos.generationRuns.update(runId, {
      status: 'cancelled',
      finishedAt: deps.clock.now(),
    })
    await deps.repos.paths.update(existing.pathId, { status: 'draft' })
    return cancelledRun
  }

  return { start, resume, cancel, active: () => [...active.keys()] }
}
