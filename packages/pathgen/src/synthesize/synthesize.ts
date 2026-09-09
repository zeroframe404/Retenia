import type {
  AiBinding,
  AiClient,
  AiRegistry,
  CacheDecision,
  CachePlan,
  StructuredResult,
  TokenCounter,
} from '@retenia/ai'
import { cacheTtlFor, customId, isAiError, resolveTargets, withCache } from '@retenia/ai'
import type { AbortSignalLike } from '@retenia/core'
import type { BudgetGuard } from '../budget'
import type { GenerationConfig } from '../config/generation-config'
import { orderedSourceIds } from '../config/generation-config'
import type { ConsolidatedConcept } from '../consolidate'
import { GenerationError } from '../errors'
import { runPool } from '../extract/pool'
import { GENERATION_PURPOSE } from '../extract/request'
import type { PathgenLogger } from '../logger'
import { type PathgenPrompt, type PathgenPrompts, systemFor } from '../prompts'
import {
  SYNTHESIZE_MODULE_SCHEMA_NAME,
  SYNTHESIZE_OUTLINE_SCHEMA_NAME,
  type SynthesizeModuleOutput,
  type SynthesizeOutlineOutput,
  synthesizeModuleOutputSchema,
  synthesizeOutlineOutputSchema,
} from '../schemas/outline'
import { type GenerationWarning, warning } from '../schemas/warnings'
import { addUsage, type StageUsage, usageOf, wasProviderCall, ZERO_USAGE } from '../usage'
import { validateGraph } from '../validate/graph'
import type { ChunkIndex, Outline, SectionSpec, ValidatedSynthesis } from '../validate/types'
import { DEFAULT_IMPORTANCE_THRESHOLD } from '../validate/types'
import { validateSynthesis } from '../validate/validate'
import { buildGraph } from './build-graph'
import { buildSynthesisInputs, type TocChunk, type TocSource } from './inputs'
import { fixSkeleton, type SkeletonModule } from './skeleton'
import {
  buildModuleTask,
  buildOutlineTask,
  DEFAULT_MODULE_CONCURRENCY,
  MODULE_MAX_OUTPUT_TOKENS,
  MODULE_STAGE,
  moduleKey,
  OUTLINE_MAX_OUTPUT_TOKENS,
  OUTLINE_SANITIZE_LIMITS,
  OUTLINE_STAGE,
} from './tasks'

/**
 * Stage 4 of `docs/spec/04-path-generation.md` §3, "outline first, then expand": one call
 * for the graph and the skeleton, then one call per module for its lessons, every module
 * reading the same cached prefix (§7 stage 7's arrangement, applied to the outline).
 *
 * Every answer is keyed by what it was asked about — the configuration, the concept set and
 * the table of contents for the outline; the outline's id and the module's place, title and
 * concepts for a module — so a resumed run replays all of it from `ai_results` and a run over
 * an unchanged book pays nothing (§7). Between the two rounds the skeleton is made consistent
 * with the validated graph, and after them the whole outline goes through the validation
 * gates exactly once.
 */

export interface SynthesizeProgress {
  readonly phase: 'outline' | 'modules'
  readonly done: number
  readonly total: number
}

export interface SynthesizeDeps {
  readonly ai: Pick<AiClient, 'structured'>
  readonly registry: () => Promise<AiRegistry>
  readonly prompts: Pick<PathgenPrompts, 'outline' | 'module'>
  readonly countTokens?: TokenCounter
  readonly logger: PathgenLogger
  /** Module calls in flight at once, after the first. */
  readonly concurrency?: number
  readonly onProgress?: (progress: SynthesizeProgress) => void
}

export interface SynthesizeInput {
  readonly config: GenerationConfig
  readonly configHash: string
  readonly sources: readonly TocSource[]
  /** Every chunk in scope, front matter included — the table of contents skips it itself. */
  readonly chunks: readonly TocChunk[]
  readonly chunkIndex: ChunkIndex
  readonly concepts: readonly ConsolidatedConcept[]
  readonly allowOverBudget: boolean
  readonly budget?: BudgetGuard
  readonly outlineEstimateUsd?: number
  readonly perModuleEstimateUsd?: number
  readonly importanceThreshold?: number
  readonly signal?: AbortSignalLike
}

export type SynthesizeStatus = 'completed' | 'cancelled' | 'blocked_budget'

export interface SynthesizeResult {
  readonly status: SynthesizeStatus
  /** Present only when `status` is `completed`; its `fatal` says whether anything survived. */
  readonly validated: ValidatedSynthesis | null
  readonly excluded: Array<{ readonly heading_path: string; readonly reason: string }>
  readonly outlineId: string
  readonly target: { readonly provider: string; readonly model: string }
  readonly cacheDecision: CacheDecision
  readonly usage: StageUsage
  readonly calls: { readonly outline: number; readonly modules: number }
  readonly cacheHits: { readonly outline: number; readonly modules: number }
  readonly modelsUsed: { readonly outline: string[]; readonly module: string[] }
  /** What synthesis itself found; the validation gates' warnings are in `validated`. */
  readonly warnings: GenerationWarning[]
  readonly inputs: {
    readonly tocHash: string
    readonly conceptSetHash: string
    readonly conceptsListed: number
    readonly conceptsOmitted: number
    readonly modules: number
  }
}

function bindingFor(prompt: PathgenPrompt, stage: string, allowOverBudget: boolean): AiBinding {
  return {
    role: prompt.role,
    purpose: GENERATION_PURPOSE,
    stage,
    promptVersion: prompt.promptVersion,
    schemaVersion: prompt.schemaVersion,
    ...(allowOverBudget ? { allowOverBudget: true } : {}),
  }
}

type Interruption = 'cancelled' | 'budget' | undefined

function interruptionOf(error: unknown, signal: AbortSignalLike | undefined): Interruption {
  if (signal?.aborted === true) return 'cancelled'
  if (isAiError(error)) {
    if (error.code === 'aborted') return 'cancelled'
    if (error.code === 'budget_exceeded') return 'budget'
  }
  return undefined
}

export async function synthesize(
  deps: SynthesizeDeps,
  input: SynthesizeInput,
): Promise<SynthesizeResult> {
  const budget = input.allowOverBudget ? undefined : input.budget
  const threshold = input.importanceThreshold ?? DEFAULT_IMPORTANCE_THRESHOLD
  const sourceIds = orderedSourceIds(input.config)
  const countTokens = deps.countTokens
  const inputs = buildSynthesisInputs(input.sources, input.chunks, input.concepts, {
    ...(countTokens === undefined ? {} : { countTokens }),
    threshold,
  })
  const [target] = resolveTargets(deps.prompts.outline.role, await deps.registry())
  if (target === undefined) throw new Error('[pathgen] resolveTargets returned no target')
  const targetInfo = { provider: target.profile.id, model: target.modelId }

  const warnings: GenerationWarning[] = []
  let usage = ZERO_USAGE
  const calls = { outline: 0, modules: 0 }
  const cacheHits = { outline: 0, modules: 0 }
  const modelsUsed = { outline: new Set<string>(), module: new Set<string>() }
  let status: SynthesizeStatus = 'completed'

  const account = (
    result: StructuredResult<unknown>,
    kind: 'outline' | 'modules',
    models: Set<string>,
  ): void => {
    if (wasProviderCall(result.usage)) {
      calls[kind] += 1
      models.add(result.model)
      const spent = usageOf(result.usage)
      usage = addUsage(usage, spent)
      budget?.add(spent.usd)
    } else {
      cacheHits[kind] += 1
    }
  }

  const outlineId = customId({
    stage: OUTLINE_STAGE,
    inputIds: [input.configHash, inputs.conceptSetHash, inputs.tocHash],
    promptVersion: deps.prompts.outline.promptVersion,
    schemaVersion: deps.prompts.outline.schemaVersion,
  })

  const planOptions = {
    profile: target.profile,
    modelId: target.modelId,
    labels: ['toc', 'concepts'],
    ...(countTokens === undefined ? {} : { countTokens }),
  } as const
  const prefixOf = (plan: CachePlan) => ({
    system: plan.system,
    cachePrefix: plan.cachePrefix,
    ...(plan.cache === undefined ? {} : { cache: plan.cache }),
  })
  const signalOf = input.signal === undefined ? {} : { signal: input.signal }

  const finish = (
    validated: ValidatedSynthesis | null,
    excluded: SynthesizeResult['excluded'],
    cacheDecision: CacheDecision,
    modules: number,
  ): SynthesizeResult => ({
    status,
    validated,
    excluded,
    outlineId,
    target: targetInfo,
    cacheDecision,
    usage,
    calls,
    cacheHits,
    modelsUsed: { outline: [...modelsUsed.outline].sort(), module: [...modelsUsed.module].sort() },
    warnings,
    inputs: {
      tocHash: inputs.tocHash,
      conceptSetHash: inputs.conceptSetHash,
      conceptsListed: inputs.concepts.included.length,
      conceptsOmitted: inputs.concepts.omitted,
      modules,
    },
  })

  // --- the outline -----------------------------------------------------------------------
  const outlinePlan = withCache(
    systemFor(deps.prompts.outline.template),
    [inputs.toc, inputs.concepts.text],
    { ...planOptions, ttl: '5m' },
  )
  if (budget?.wouldExceed(input.outlineEstimateUsd ?? 0) === true) {
    status = 'blocked_budget'
    warnings.push(warning('budget_paused', { reason: 'cap', pending: 1, stage: 'outline' }))
    return finish(null, [], outlinePlan.decision, 0)
  }
  deps.onProgress?.({ phase: 'outline', done: 0, total: 1 })

  const outlineTask = buildOutlineTask(input.config, input.sources, {
    included: inputs.concepts.included.length,
    omitted: inputs.concepts.omitted,
  })
  // Reported, never acted on: the material still goes to the model, wrapped.
  if (outlinePlan.injectionSuspected) {
    warnings.push(warning('synthesis_injection_suspected', { block: 'prefix' }))
  }
  if (outlineTask.injectionSuspected) {
    warnings.push(warning('synthesis_injection_suspected', { block: 'sources' }))
  }

  let outline: StructuredResult<SynthesizeOutlineOutput>
  try {
    outline = await deps.ai.structured(
      bindingFor(deps.prompts.outline, OUTLINE_STAGE, input.allowOverBudget),
    )({
      ...prefixOf(outlinePlan),
      prompt: outlineTask.text,
      temperature: deps.prompts.outline.temperature,
      schema: synthesizeOutlineOutputSchema,
      schemaName: SYNTHESIZE_OUTLINE_SCHEMA_NAME,
      maxOutputTokens: OUTLINE_MAX_OUTPUT_TOKENS,
      sanitizeLimits: OUTLINE_SANITIZE_LIMITS,
      idempotencyKey: outlineId,
      ...signalOf,
    })
  } catch (error) {
    const interruption = interruptionOf(error, input.signal)
    if (interruption === undefined) throw error
    status = interruption === 'cancelled' ? 'cancelled' : 'blocked_budget'
    if (interruption === 'budget') {
      warnings.push(warning('budget_paused', { reason: 'monthly', pending: 1, stage: 'outline' }))
    }
    return finish(null, [], outlinePlan.decision, 0)
  }
  account(outline, 'outline', modelsUsed.outline)
  deps.onProgress?.({ phase: 'outline', done: 1, total: 1 })

  const excluded = outline.value.excluded.map((entry) => ({ ...entry }))
  for (const entry of excluded) {
    warnings.push(
      warning('chunk_excluded', { heading_path: entry.heading_path, reason: entry.reason }),
    )
  }

  // --- the graph and the skeleton --------------------------------------------------------
  const built = buildGraph(outline.value.graph, input.concepts, { threshold })
  warnings.push(...built.warnings)
  const ctx = { chunks: input.chunkIndex, sourceIds, importanceThreshold: threshold }
  const graphValidation = validateGraph(built.graph, ctx)
  warnings.push(...graphValidation.warnings)
  const skeleton = fixSkeleton(outline.value.sections, graphValidation.graph, {
    sourceIds,
    threshold,
  })
  warnings.push(...skeleton.warnings)

  const modules = skeleton.sections.flatMap((section) => section.modules)
  const modelWarnings = [...outline.value.warnings]
  if (modules.length === 0) {
    const validated = validateSynthesis(
      graphValidation.graph,
      { sections: [], misconceptions: [], warnings: modelWarnings },
      ctx,
    )
    return finish(validated, excluded, outlinePlan.decision, 0)
  }

  // --- the modules -----------------------------------------------------------------------
  const modulePlan = withCache(
    systemFor(deps.prompts.module.template),
    [inputs.toc, inputs.concepts.text],
    { ...planOptions, ttl: cacheTtlFor({ pathGeneration: true }) },
  )
  const moduleBinding = bindingFor(deps.prompts.module, MODULE_STAGE, input.allowOverBudget)
  const conceptsById = new Map(input.concepts.map((concept) => [concept.concept_id, concept]))
  const results: Array<SynthesizeModuleOutput | undefined> = new Array(modules.length)
  let done = 0
  let interrupted: Interruption
  const stopped = (): boolean => interrupted !== undefined

  const runModule = async (module: SkeletonModule, index: number): Promise<void> => {
    if (stopped()) return
    if (input.signal?.aborted === true) {
      interrupted = 'cancelled'
      return
    }
    // One call at a time against the cap, like extraction: the quote judged the whole job.
    if (budget?.wouldExceed(input.perModuleEstimateUsd ?? 0) === true) {
      interrupted = 'budget'
      warnings.push(
        warning('budget_paused', {
          reason: 'cap',
          pending: modules.length - done,
          stage: 'modules',
        }),
      )
      return
    }
    const section = skeleton.sections[module.sectionIndex]
    const key = moduleKey(module.sectionIndex, module.moduleIndex, module.title, module.conceptIds)
    const task = buildModuleTask({
      sectionIndex: module.sectionIndex,
      sectionCount: outline.value.sections.length,
      sectionTitle: section?.title ?? '',
      moduleIndex: module.moduleIndex,
      moduleCount: outline.value.sections[module.sectionIndex]?.modules.length ?? 1,
      moduleTitle: module.title,
      objectives: module.objectives,
      concepts: module.conceptIds.map((id) => conceptsById.get(id) as ConsolidatedConcept),
      config: input.config,
    })
    if (task.injectionSuspected) {
      warnings.push(
        warning('synthesis_injection_suspected', { block: 'module', module: module.title }),
      )
    }
    try {
      const result = await deps.ai.structured(moduleBinding)({
        ...prefixOf(modulePlan),
        prompt: task.text,
        temperature: deps.prompts.module.temperature,
        schema: synthesizeModuleOutputSchema,
        schemaName: SYNTHESIZE_MODULE_SCHEMA_NAME,
        maxOutputTokens: MODULE_MAX_OUTPUT_TOKENS,
        idempotencyKey: customId({
          stage: MODULE_STAGE,
          inputIds: [outlineId, key],
          promptVersion: deps.prompts.module.promptVersion,
          schemaVersion: deps.prompts.module.schemaVersion,
        }),
        ...signalOf,
      })
      results[index] = result.value
      account(result, 'modules', modelsUsed.module)
      done += 1
      deps.onProgress?.({ phase: 'modules', done, total: modules.length })
    } catch (error) {
      const interruption = interruptionOf(error, input.signal)
      if (interruption === undefined) {
        throw new GenerationError(
          'module_failed',
          `the lessons of module "${module.title}" could not be synthesized: ` +
            (error instanceof Error ? error.message : String(error)),
        )
      }
      if (interruption === 'budget') {
        warnings.push(
          warning('budget_paused', {
            reason: 'monthly',
            pending: modules.length - done,
            stage: 'modules',
          }),
        )
      }
      interrupted = interruption
    }
  }

  // The first call alone, so it writes the shared prefix once; the rest read it.
  deps.onProgress?.({ phase: 'modules', done: 0, total: modules.length })
  await runModule(modules[0] as SkeletonModule, 0)
  await runPool(
    modules.slice(1),
    deps.concurrency ?? DEFAULT_MODULE_CONCURRENCY,
    (module, index) => runModule(module, index + 1),
    stopped,
  )

  if (interrupted !== undefined) {
    status = interrupted === 'cancelled' ? 'cancelled' : 'blocked_budget'
    return finish(null, excluded, modulePlan.decision, modules.length)
  }

  // --- assemble and validate -------------------------------------------------------------
  let flat = 0
  const sections: SectionSpec[] = skeleton.sections.map((section) => ({
    title: section.title,
    modules: section.modules.map((module) => {
      const output = results[flat] as SynthesizeModuleOutput
      flat += 1
      return {
        title: module.title,
        objectives: module.objectives,
        lesson_specs: output.lesson_specs.map((spec) => ({
          title: spec.title,
          concept_ids: [...spec.concept_ids],
          objectives: spec.objectives.map((objective) => ({ ...objective })),
          estimated_minutes: spec.estimated_minutes,
          origin: 'model' as const,
        })),
      }
    }),
  }))
  const outlineDoc: Outline = {
    sections,
    misconceptions: results.flatMap((output) =>
      (output as SynthesizeModuleOutput).misconceptions.map((entry) => ({ ...entry })),
    ),
    warnings: [
      ...modelWarnings,
      ...results.flatMap((output) => (output as SynthesizeModuleOutput).warnings),
    ],
  }
  const validated = validateSynthesis(graphValidation.graph, outlineDoc, ctx)
  return finish(validated, excluded, modulePlan.decision, modules.length)
}
