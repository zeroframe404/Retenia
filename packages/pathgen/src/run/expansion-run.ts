import type { AbortSignalLike, GenerationRun, GenerationRunRepository } from '@retenia/core'
import type { BudgetGuard } from '../budget'
import { type GenerationConfig, parseGenerationConfig } from '../config/generation-config'
import { GenerationError } from '../errors'
import {
  type ConceptFacts,
  type ExpandDeps,
  type ExpandStageResult,
  expandLessons,
} from '../expand'
import { asJson } from '../json'
import { knowledgeGraphDocumentSchema } from '../schemas/knowledge-graph'
import { type PathDraft, pathDraftSchema } from '../schemas/path-draft'
import type { GenerationWarning } from '../schemas/warnings'

/**
 * Stage 7 as a run of its own (`docs/spec/04-path-generation.md` §3 stage 7).
 *
 * A **second `generation_runs` row**, not a sixth stage of the first one. The draft's run
 * reaches `completed` at `persisting`, and freezing the path is a separate user action that
 * may come days later — a run cannot sit `running` across that. Giving expansion its own row
 * costs nothing and buys everything the extraction stage already has: `progress.batch_ids` as
 * the batch ledger, the four cost columns, `manifest`, and `listActive()` for the startup
 * sweep that picks up a batch the app outlived.
 *
 * It is deliberately much smaller than `generation-run.ts`. That orchestrator sequences five
 * stages with a checkpoint between each; this one has a single stage whose own five-step
 * order lives in `expand/wave.ts`, so all this owns is the row.
 */

export interface ExpansionRepos {
  readonly paths: {
    findVersion: (
      id: string,
    ) => Promise<{ id: string; pathId: string; spec: unknown; knowledgeGraph: unknown } | undefined>
  }
  readonly generationRuns: Pick<
    GenerationRunRepository,
    'findById' | 'create' | 'update' | 'listActive' | 'findLatestByPath'
  >
}

export interface ExpansionRunDeps extends ExpandDeps {
  readonly runs: ExpansionRepos
}

export interface ExpandOptions {
  readonly userWaiting?: boolean
  readonly allowOverBudget?: boolean
  readonly budget?: BudgetGuard
  /** Only these lessons, by `spec_id`; used by "Regenerar" and "Más ejemplos". */
  readonly onlyLessonIds?: readonly string[]
  readonly regenerate?: boolean
  readonly moreExamples?: boolean
  readonly signal?: AbortSignalLike
}

export interface ExpansionResult {
  readonly runId: string
  readonly pathId: string
  readonly pathVersionId: string
  readonly status: GenerationRun['status']
  readonly stage: ExpandStageResult
  readonly warnings: readonly GenerationWarning[]
  readonly error: string | null
}

export interface ExpansionRunHandle {
  /** Expands a frozen version, creating or reusing its `expanding` run row. */
  expand(pathVersionId: string, options?: ExpandOptions): Promise<ExpansionResult>
  /** Picks an `expanding` row back up: its batches, then whatever is still `pending`. */
  resume(runId: string, options?: ExpandOptions): Promise<ExpansionResult>
  /** Every `expanding` row this process should adopt at startup. */
  active(): Promise<readonly GenerationRun[]>
}

/** `path_versions.knowledge_graph` as the facts P3, P4 and P5 read about a concept. */
export function conceptsOf(knowledgeGraph: unknown): ReadonlyMap<string, ConceptFacts> {
  const parsed = knowledgeGraphDocumentSchema.safeParse(knowledgeGraph)
  if (!parsed.success) return new Map()
  return new Map(
    parsed.data.nodes.map((node) => [
      node.concept_id,
      {
        id: node.concept_id,
        name: node.canonical,
        definition: node.definition,
        kind: node.kind,
      },
    ]),
  )
}

interface Progress {
  readonly stage: 'expanding'
  readonly done: number
  readonly total: number
  readonly batch_ids: string[]
}

function readBatchIds(run: GenerationRun): string[] {
  const progress = run.progress as Partial<Progress> | null
  return Array.isArray(progress?.batch_ids)
    ? progress.batch_ids.filter((id): id is string => typeof id === 'string')
    : []
}

export function createExpansionRun(deps: ExpansionRunDeps): ExpansionRunHandle {
  /**
   * The expansions this process is executing, by path version.
   *
   * Without it a second `pathgen.expand` for the same version — the completion panel
   * remounting after a renderer reload, or the startup sweep racing a button — would run
   * `expandLessons` a second time over the same lessons. The two passes would build the same
   * `custom_id`s, miss the same `ai_results` rows (nothing is written until an answer
   * arrives) and pay for every call twice. `createGenerationRun` keeps the same kind of
   * process-local map for the same reason.
   *
   * Returning the in-flight promise rather than a fresh row is what makes "press it again"
   * mean "keep going", which is what a user pressing it again means.
   */
  const inFlight = new Map<string, Promise<ExpansionResult>>()

  const once = (
    pathVersionId: string,
    work: () => Promise<ExpansionResult>,
  ): Promise<ExpansionResult> => {
    const running = inFlight.get(pathVersionId)
    if (running !== undefined) return running
    const started = work().finally(() => inFlight.delete(pathVersionId))
    inFlight.set(pathVersionId, started)
    return started
  }

  const load = async (pathVersionId: string) => {
    const version = await deps.runs.paths.findVersion(pathVersionId)
    if (version === undefined) {
      throw new GenerationError('version_not_found', `no path version "${pathVersionId}"`)
    }
    const draft: PathDraft = pathDraftSchema.parse(version.spec)
    return { version, draft, concepts: conceptsOf(version.knowledgeGraph) }
  }

  /**
   * The config the draft was generated with, re-derived from the draft itself.
   *
   * The run row carries a `config`, but expansion may be started by a different run than the
   * one that wrote the draft — and the frozen draft is the authority on what the path *is*.
   * `parseGenerationConfig` fills the wizard-only fields (pace, scope, budget) with their
   * defaults, none of which P3, P4 or P5 reads.
   */
  const configOf = (draft: PathDraft): GenerationConfig => {
    const sourceIds = [...new Set(draft.sources.map((source) => source.source_id))]
    const primary = draft.sources.find((source) => source.primary)?.source_id ?? sourceIds[0]
    if (primary === undefined) {
      throw new GenerationError('no_sources', 'the frozen draft names no sources to expand from')
    }
    return parseGenerationConfig({
      goal: draft.goal,
      level: draft.level,
      lessonLanguage: draft.language,
      targetLanguage: draft.target_language,
      sourceIds,
      primarySourceId: primary,
      // `forExam` is the exam's date, not a flag: it is what raises every flashcard this path
      // creates to `urgent` (§11 rule 3).
      forExam: draft.target_date === null ? null : { date: draft.target_date },
    })
  }

  const run = async (
    row: GenerationRun,
    pathVersionId: string,
    options: ExpandOptions,
  ): Promise<ExpansionResult> => {
    const { draft, concepts } = await load(pathVersionId)
    const batchIds = readBatchIds(row)
    const seenBatches = new Set(batchIds)

    const checkpoint = async (patch: Partial<GenerationRun>): Promise<void> => {
      await deps.runs.generationRuns.update(row.id, patch)
    }

    let stage: ExpandStageResult
    try {
      stage = await expandLessons(
        {
          ...deps,
          onProgress: (progress) => deps.onProgress?.(progress),
          onBatch: async (batchId) => {
            // Persisted *before* anything waits on it, so a process that dies mid-batch
            // resumes by awaiting it rather than by paying for it again.
            if (seenBatches.has(batchId)) return
            seenBatches.add(batchId)
            batchIds.push(batchId)
            await checkpoint({
              progress: asJson({ stage: 'expanding', done: 0, total: 0, batch_ids: batchIds }),
            })
            await deps.onBatch?.(batchId)
          },
        },
        {
          runId: row.id,
          pathId: row.pathId,
          pathVersionId,
          config: configOf(draft),
          draft,
          concepts,
          userWaiting: options.userWaiting ?? false,
          allowOverBudget: options.allowOverBudget ?? false,
          ...(options.budget === undefined ? {} : { budget: options.budget }),
          ...(options.onlyLessonIds === undefined ? {} : { onlyLessonIds: options.onlyLessonIds }),
          ...(options.regenerate === undefined ? {} : { regenerate: options.regenerate }),
          ...(options.moreExamples === undefined ? {} : { moreExamples: options.moreExamples }),
          batchIds,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await checkpoint({
        status: 'failed',
        error: message,
        finishedAt: deps.clock.now(),
      })
      throw error
    }

    const status: GenerationRun['status'] =
      stage.status === 'completed'
        ? 'completed'
        : stage.status === 'cancelled'
          ? 'cancelled'
          : 'blocked_budget'

    await checkpoint({
      status,
      progress: asJson({
        stage: 'expanding',
        done: stage.expanded + stage.reused,
        total: stage.expanded + stage.reused + stage.pending + stage.failed.length,
        batch_ids: [...new Set([...batchIds, ...stage.batchIds])],
      }),
      warnings: stage.warnings as never,
      costUsd: row.costUsd + stage.usage.usd,
      inputTokens: row.inputTokens + stage.usage.inputTokens,
      outputTokens: row.outputTokens + stage.usage.outputTokens,
      cachedTokens: row.cachedTokens + stage.usage.cachedTokens,
      ...(status === 'completed' || status === 'cancelled' ? { finishedAt: deps.clock.now() } : {}),
    })

    return {
      runId: row.id,
      pathId: row.pathId,
      pathVersionId,
      status,
      stage,
      warnings: stage.warnings,
      error: null,
    }
  }

  return {
    expand: (pathVersionId, options = {}) =>
      once(pathVersionId, async () => {
        const { version, draft } = await load(pathVersionId)
        const latest = await deps.runs.generationRuns.findLatestByPath(version.pathId)
        // One `expanding` row per path at a time: a second press of "Expandir" continues the
        // first rather than opening a run that would fight it for the same lessons.
        const row =
          latest !== undefined &&
          latest.status === 'expanding' &&
          latest.pathVersionId === version.id
            ? latest
            : await deps.runs.generationRuns.create({
                pathId: version.pathId,
                pathVersionId: version.id,
                status: 'expanding',
                config: asJson(configOf(draft)),
                configHash: '0'.repeat(64),
                progress: asJson({ stage: 'expanding', done: 0, total: 0, batch_ids: [] }),
                estimate: null,
                costUsd: 0,
                inputTokens: 0,
                outputTokens: 0,
                cachedTokens: 0,
                manifest: null,
                warnings: [],
                error: null,
                startedAt: deps.clock.now(),
                finishedAt: null,
              })
        if (row.status !== 'expanding') {
          await deps.runs.generationRuns.update(row.id, { status: 'expanding', finishedAt: null })
        }
        return run({ ...row, status: 'expanding' }, version.id, options)
      }),

    resume: async (runId, options = {}) => {
      const row = await deps.runs.generationRuns.findById(runId)
      if (row === undefined) throw new GenerationError('run_not_found', `no run "${runId}"`)
      if (row.pathVersionId === null) {
        throw new GenerationError('version_not_found', `run "${runId}" has no path version`)
      }
      const versionId = row.pathVersionId
      return once(versionId, async () => {
        await deps.runs.generationRuns.update(row.id, { status: 'expanding', finishedAt: null })
        return run({ ...row, status: 'expanding' }, versionId, options)
      })
    },

    active: async () =>
      (await deps.runs.generationRuns.listActive()).filter((row) => row.status === 'expanding'),
  }
}
