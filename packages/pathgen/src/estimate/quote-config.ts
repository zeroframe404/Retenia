import type { AiClient, BatchRunner, TokenCounter } from '@retenia/ai'
import { approximateTokens, structuredRequestFor } from '@retenia/ai'
import type { Chunk, ChunkRepository, SourceRepository } from '@retenia/core'
import {
  type GenerationConfig,
  type GenerationConfigInput,
  orderedSourceIds,
  parseGenerationConfig,
} from '../config/generation-config'
import { GenerationError } from '../errors'
import { type PathgenPrompt, type PathgenPrompts, systemFor } from '../prompts'
import { DEFAULT_GENERATION_CONCURRENCY, type GenerationConcurrency } from '../run/deps'
import { type ChunkPlan, planChunks } from '../run/plan-chunks'
import { extractChunkOutputSchema } from '../schemas/extraction'
import { synthesizeModuleOutputSchema, synthesizeOutlineOutputSchema } from '../schemas/outline'
import { estimateGeneration, type GenerationEstimate } from './estimate-generation'

/**
 * The chunk plan and the priced estimate a generation config produces — factored out of
 * `run/generation-run.ts` so the wizard's step-1 "live estimate"
 * (`docs/spec/04-path-generation.md` §13 step 1, sub-phase 8.2's `pathgen.quote`) asks exactly
 * the question `start`/`resume` already ask internally, rather than a second copy that could
 * drift from what a run actually charges. Neither function here writes anything.
 */

export interface QuotePlanRepos {
  readonly sources: Pick<SourceRepository, 'findMany'>
  readonly chunks: Pick<ChunkRepository, 'listBySource'>
}

export interface QuoteDeps {
  readonly ai: Pick<AiClient, 'ratesFor'>
  /** Only checked for presence: batch dispatch only makes sense once a runner exists. */
  readonly runner?: BatchRunner
  readonly repos: QuotePlanRepos
  readonly prompts: PathgenPrompts
  readonly countTokens?: TokenCounter
  readonly concurrency?: Partial<GenerationConcurrency>
}

export interface QuoteOptions {
  /** Defaults to `true`: somebody is watching, so dispatch stays synchronous. */
  readonly userWaiting?: boolean
  /** Chunks that would cost nothing — already extracted by a previous attempt. */
  readonly alreadyExtracted?: number
}

/**
 * Which chunks a config would read, resolved from the library.
 *
 * Throws `no_sources` for a source id with no `sources` row, and `no_chunks` when nothing
 * survives scope and front-matter exclusion — the same two failure modes `start` raises today,
 * now raised identically by a pre-flight quote.
 */
export async function loadPlan(
  deps: { repos: QuotePlanRepos },
  config: GenerationConfig,
): Promise<ChunkPlan> {
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

function systemTokensOf(
  countTokens: TokenCounter,
  prompt: PathgenPrompt,
  schema: Parameters<typeof structuredRequestFor>[0]['schema'],
): number {
  return countTokens(
    structuredRequestFor({
      system: systemFor(prompt.template),
      prompt: '',
      temperature: 0,
      schema,
    }).system ?? '',
  )
}

/** Prices a plan already loaded — the exact computation `run/generation-run.ts` performs at
 *  every quote point, shared so the wizard's number can never drift from what a run charges. */
export async function quoteFromPlan(
  deps: QuoteDeps,
  plan: ChunkPlan,
  options: QuoteOptions = {},
): Promise<GenerationEstimate> {
  const userWaiting = options.userWaiting ?? true
  const countTokens = deps.countTokens ?? approximateTokens
  const concurrency = { ...DEFAULT_GENERATION_CONCURRENCY, ...deps.concurrency }
  const [cheap, smart] = await Promise.all([deps.ai.ratesFor('cheap'), deps.ai.ratesFor('smart')])
  return estimateGeneration({
    chunks: plan.extractable,
    alreadyExtracted: options.alreadyExtracted ?? 0,
    rates: {
      ...(cheap === undefined ? {} : { cheap }),
      ...(smart === undefined ? {} : { smart }),
    },
    systemTokens: {
      extract: systemTokensOf(countTokens, deps.prompts.extract, extractChunkOutputSchema),
      outline: systemTokensOf(countTokens, deps.prompts.outline, synthesizeOutlineOutputSchema),
      module: systemTokensOf(countTokens, deps.prompts.module, synthesizeModuleOutputSchema),
    },
    dispatch: !userWaiting && deps.runner !== undefined ? 'batch' : 'sync',
    countTokens,
    concurrency,
  })
}

export interface QuoteResult {
  readonly config: GenerationConfig
  readonly plan: ChunkPlan
  readonly estimate: GenerationEstimate
}

/** The wizard's whole step-1 question in one call: parse the config, load its plan, price it.
 *  Creates no `paths` or `generation_runs` row — call `createGenerationRun(...).start` for that. */
export async function quoteConfig(
  deps: QuoteDeps,
  input: GenerationConfigInput,
  options: QuoteOptions = {},
): Promise<QuoteResult> {
  const config = parseGenerationConfig(input)
  const plan = await loadPlan(deps, config)
  const estimate = await quoteFromPlan(deps, plan, options)
  return { config, plan, estimate }
}
