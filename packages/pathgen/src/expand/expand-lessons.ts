import { resolveTargets } from '@retenia/ai'
import type {
  AbortSignalLike,
  ActivityAuthorRequest,
  ImportanceLevel,
  LessonStatus,
} from '@retenia/core'
import type { BudgetGuard } from '../budget'
import type { GenerationConfig } from '../config/generation-config'
import type { GenerationStage } from '../progress/stages'
import { systemFor } from '../prompts'
import { type LessonQaSummary, summarizeQa } from '../qa/lesson-qa'
import { persistQa } from '../qa/persist'
import type { QaLessonInput } from '../qa/pipeline'
import { needsFlashcards } from '../regenerate/migrate'
import type { MakeFlashcardsOutput } from '../schemas/flashcards'
import type { LessonCitation, LessonTheory, WriteLessonOutput } from '../schemas/lesson'
import type { PathDraft } from '../schemas/path-draft'
import { dedupeWarnings, type GenerationWarning, warning } from '../schemas/warnings'
import { addUsage, type StageUsage, ZERO_USAGE } from '../usage'
import { resolveCitations } from './citations'
import { buildLessonContext, type LessonContext } from './context'
import { DEFAULT_EXPAND_CONCURRENCY, type ExpandDeps } from './deps'
import { familiesFor } from './families'
import { dedupeByEmbedding, frontKey, MIN_FLASHCARDS_PER_LESSON, toMemoryItems } from './flashcards'
import { markLesson, persistFlashcards, persistPractice, persistTheory } from './persist'
import {
  type ConceptFacts,
  chunkIndex,
  glossaryOf,
  importanceFloorOf,
  type LessonPlan,
  mappedChunkIds,
  planLessons,
  retrievalQuery,
} from './plan'
import { composePractice, LESSON_PRACTICE_LIMITS } from './practice'
import { buildLessonPrefix } from './prefix'
import {
  buildFlashcardRequest,
  buildTheoryRequest,
  expansionBinding,
  MAKE_FLASHCARDS_STAGE,
  WRITE_LESSON_STAGE,
} from './requests'
import { runWave, type WaveResult } from './wave'

/**
 * Stage 7 of `docs/spec/04-path-generation.md` §3: *"Batch expansion (mid) + 2 lessons in
 * real time"*, over the lessons `freezePath` materialised.
 *
 * The shape of the run is what §3 asks for and what §14 pitfall 18 warns about. The **first
 * two lessons run as a whole pipeline synchronously** — P3, then P4's families and P5 — so a
 * learner has something complete to start on in under a minute; **the rest goes through the
 * Batch API in waves**, at half price, and may take an hour without anybody waiting.
 *
 * The tail is two waves rather than three. P4 and P5 both read the theory P3 wrote and
 * neither reads the other, so once the theory wave has landed they are siblings. They are
 * nonetheless dispatched one after the other rather than together: both spend from the same
 * `BudgetGuard`, and two waves submitting concurrently could each pass the cap check before
 * either had charged, which is the one way a run can overspend its own quote.
 *
 * A lesson that fails is a warning, never a failure of the run — the policy P1 already
 * applies to a chunk. `reinforcement` and `checkpoint` rows are not expanded at all: they
 * compose items that already exist, which is sub-phase 8.5's.
 *
 * **Stage 8** (sub-phase 8.4) follows the cards when a `QaPipeline` is wired: the row moves
 * to `qa` instead of `ready`, the gates of §5 run over the group as three more waves, and
 * `ready` becomes the gates' verdict. A lesson under §5's thresholds goes back to P3
 * exactly once — the same three steps at the next revision, the cards kept — and a second
 * failure is flagged for the user rather than rewritten again.
 */

/** §3 stage 7: *"the first two lessons are synchronous so the user starts in < 1 min"*. */
export const SYNCHRONOUS_HEAD_LESSONS = 2
/** Retrieval hits asked for per lesson, before the token budget trims them. */
export const RETRIEVAL_K = 8
/** Past this share of failed lessons the caller should fail the run rather than ship it. */
export const MAX_FAILED_LESSON_RATIO = 0.5

export interface ExpandProgress {
  readonly runId: string
  readonly stage: GenerationStage
  readonly done: number
  readonly total: number
  readonly lessonSpecId?: string
  readonly batchId?: string
}

/** One lesson's row changed — what the expansion panel redraws on. */
export interface LessonProgress {
  readonly runId: string
  readonly pathVersionId: string
  readonly lessonId: string
  readonly specId: string
  readonly status: LessonStatus
  readonly activities: number
  readonly flashcards: number
  /** The gates' verdict, once there is one — what the badges redraw on. */
  readonly qa?: LessonQaSummary
}

/** How the gates left the group: what the completion summary and the run's log report. */
export interface ExpandQaCounts {
  /** Lessons every gate ran over to a conclusion. */
  readonly reviewed: number
  readonly fixed: number
  readonly regenerated: number
  readonly flagged: number
}

export const ZERO_QA_COUNTS: ExpandQaCounts = Object.freeze({
  reviewed: 0,
  fixed: 0,
  regenerated: 0,
  flagged: 0,
})

export interface ExpandStageInput {
  readonly runId: string
  readonly pathId: string
  readonly pathVersionId: string
  readonly config: GenerationConfig
  readonly draft: PathDraft
  /** The path's concepts, from `path_versions.knowledge_graph`. */
  readonly concepts: ReadonlyMap<string, ConceptFacts>
  /** Only these lessons, by `spec_id`. Absent means every core lesson that is not `ready`. */
  readonly onlyLessonIds?: readonly string[]
  /** "Regenerar": bump the revision, force past the cache, replace the practice block. */
  readonly regenerate?: boolean
  /** "Más ejemplos": bump the family variants and append to the block. */
  readonly moreExamples?: boolean
  readonly userWaiting: boolean
  readonly allowOverBudget: boolean
  readonly budget?: BudgetGuard
  readonly perCallEstimateUsd?: number
  readonly batchIds?: readonly string[]
  readonly signal?: AbortSignalLike
}

export type ExpandStageStatus = 'completed' | 'cancelled' | 'blocked_budget'

export interface ExpandStageResult {
  readonly status: ExpandStageStatus
  /** Lessons that reached `ready` in this attempt. */
  readonly expanded: number
  /** Lessons already `ready` before it started. */
  readonly reused: number
  readonly cacheHits: number
  readonly calls: number
  readonly activities: number
  readonly flashcards: number
  readonly failed: readonly { readonly lesson: string; readonly error: string }[]
  readonly pending: number
  readonly warnings: readonly GenerationWarning[]
  readonly usage: StageUsage
  readonly batchIds: readonly string[]
  readonly modelsUsed: readonly string[]
  /**
   * The same models as `modelsUsed`, broken down by pipeline stage (`P3_write_lesson`,
   * `P4_make_activities`, `P5_make_flashcards`, and — merged in from the QA pipeline —
   * `P6_faithfulness`, `P7_pedagogy_judge`, `P8_edit`). What `expansion-run.ts` merges into
   * the version's `GenerationManifest.models` (`docs/spec/04-path-generation.md` §8) once this
   * stage completes. A stage this run never dispatched has no key here.
   */
  readonly modelsByStage: Readonly<Record<string, readonly string[]>>
  readonly qa: ExpandQaCounts
}

export function tooManyFailedLessons(
  result: Pick<ExpandStageResult, 'failed' | 'expanded'>,
): boolean {
  const attempted = result.failed.length + result.expanded
  return result.failed.length > 0 && result.failed.length > MAX_FAILED_LESSON_RATIO * attempted
}

interface Prepared {
  readonly plan: LessonPlan
  readonly context: LessonContext
  readonly revision: number
  /** `expansion.qa_regenerations` when prepared: `0` may still be sent back to P3 once, `1` may not. */
  readonly qaAttempt: number
  /** Set once P3 has landed, so P4 and P5 can be parented on it. */
  theory?: { readonly output: WriteLessonOutput; readonly customId: string; readonly model: string }
  /** The theory as `persistTheory` wrote it — after citation resolution — for the gates to read. */
  resolved?: { readonly theory: LessonTheory; readonly citations: readonly LessonCitation[] }
}

interface Totals {
  cacheHits: number
  calls: number
  activities: number
  flashcards: number
  usage: StageUsage
  batchIds: string[]
  models: Set<string>
  /** Same models, broken down by pipeline stage id — see `ExpandStageResult.modelsByStage`. */
  modelsByStage: Map<string, Set<string>>
  qa: { reviewed: number; fixed: number; regenerated: number; flagged: number }
}

function mergeModelsByStage(totals: Totals, stage: string, models: readonly string[]): void {
  if (models.length === 0) return
  const forStage = totals.modelsByStage.get(stage) ?? new Set<string>()
  for (const model of models) forStage.add(model)
  totals.modelsByStage.set(stage, forStage)
}

function accrue(
  totals: Totals,
  wave: Pick<WaveResult, 'cacheHits' | 'calls' | 'usage' | 'batchIds' | 'modelsUsed'>,
  /** Absent for the QA wave, whose own result already carries a multi-stage breakdown. */
  stage?: string,
): void {
  totals.cacheHits += wave.cacheHits
  totals.calls += wave.calls
  totals.usage = addUsage(totals.usage, wave.usage)
  totals.batchIds.push(...wave.batchIds)
  for (const model of wave.modelsUsed) totals.models.add(model)
  if (stage !== undefined) mergeModelsByStage(totals, stage, wave.modelsUsed)
}

/**
 * The path's language pair, when it teaches one (§7's "lesson in Spanish, items in English").
 *
 * This used to compare `draft.language` against `config.lessonLanguage`, which are the same
 * value by construction — `configOf` builds the config *from* the draft, and the draft's
 * language is the config's lesson language — so it always answered `null` and P3's
 * `target_language` rule could never fire. A path that teaches a language now says so
 * directly, in one field, rather than being inferred from two that cannot disagree.
 */
function targetLanguageOf(config: GenerationConfig, draft: PathDraft): string | null {
  const target = config.targetLanguage ?? draft.target_language
  return target === null || target === config.lessonLanguage ? null : target
}

export async function expandLessons(
  deps: ExpandDeps,
  input: ExpandStageInput,
): Promise<ExpandStageResult> {
  const concurrency = { ...DEFAULT_EXPAND_CONCURRENCY, ...deps.concurrency }
  const warnings: GenerationWarning[] = []
  const failed: { lesson: string; error: string }[] = []
  const totals: Totals = {
    cacheHits: 0,
    calls: 0,
    activities: 0,
    flashcards: 0,
    usage: ZERO_USAGE,
    batchIds: [],
    models: new Set<string>(),
    modelsByStage: new Map<string, Set<string>>(),
    qa: { reviewed: 0, fixed: 0, regenerated: 0, flagged: 0 },
  }
  let status: ExpandStageStatus = 'completed'

  const worsen = (next: ExpandStageStatus): void => {
    if (next === 'cancelled' || (next === 'blocked_budget' && status === 'completed')) {
      status = next
    }
  }
  const stopped = (): boolean => status !== 'completed' || input.signal?.aborted === true

  const tree = await deps.repos.paths.loadTree(input.pathVersionId)
  if (tree === undefined) {
    return {
      status: 'completed',
      expanded: 0,
      reused: 0,
      cacheHits: 0,
      calls: 0,
      activities: 0,
      flashcards: 0,
      failed: [],
      pending: 0,
      warnings: [],
      usage: ZERO_USAGE,
      batchIds: [],
      modelsUsed: [],
      modelsByStage: {},
      qa: ZERO_QA_COUNTS,
    }
  }

  const plans = planLessons({
    tree,
    draft: input.draft,
    concepts: input.concepts,
    runId: input.runId,
  })
  const wanted =
    input.onlyLessonIds === undefined
      ? plans.filter((plan) => plan.row.status !== 'ready')
      : plans.filter((plan) => input.onlyLessonIds?.includes(plan.specId) === true)
  const reused = plans.length - wanted.length

  if (wanted.length === 0) {
    return {
      status: 'completed',
      expanded: 0,
      reused,
      cacheHits: 0,
      calls: 0,
      activities: 0,
      flashcards: 0,
      failed: [],
      pending: 0,
      warnings: [],
      usage: ZERO_USAGE,
      batchIds: [],
      modelsUsed: [],
      modelsByStage: {},
      qa: ZERO_QA_COUNTS,
    }
  }

  // --- the context every lesson reads -------------------------------------------------------
  const chunks = chunkIndex(await deps.repos.chunks.findMany(mappedChunkIds(wanted)))
  const prepared: Prepared[] = []
  for (const plan of wanted) {
    const retrieved =
      deps.retrieve === undefined
        ? []
        : await deps.retrieve(retrievalQuery(plan), { k: RETRIEVAL_K, pathId: input.pathId })
    const context = buildLessonContext(
      { lesson: plan.node, chunks, retrieved, previous: plan.previous, glossary: glossaryOf(plan) },
      deps.countTokens === undefined ? {} : { countTokens: deps.countTokens },
    )
    warnings.push(...context.warnings)
    // "Regenerar" is a fresh revision by the user's hand, so the gates get their one
    // regeneration back for it; a resume keeps the counter the ledger already holds.
    if (input.regenerate === true) plan.expansion.qa_regenerations = 0
    prepared.push({
      plan,
      context,
      revision: plan.expansion.revision + (input.regenerate === true ? 1 : 0),
      qaAttempt: plan.expansion.qa_regenerations,
    })
  }

  // The fronts the path already has, so P5 sees them and the dedupe can compare against them.
  const existingFronts = new Map<string, Float32Array | null>()
  for (const plan of plans) {
    for (const item of await deps.repos.knowledgeItems.listByLesson(plan.lessonId)) {
      const fields = item.fields as { front?: unknown; cloze_text?: unknown; context_cue?: unknown }
      const front =
        typeof fields.cloze_text === 'string'
          ? fields.cloze_text
          : `${typeof fields.context_cue === 'string' ? `${fields.context_cue} ` : ''}${
              typeof fields.front === 'string' ? fields.front : ''
            }`
      const key = frontKey({ cloze_text: null, front, context_cue: null } as never)
      if (key !== '') existingFronts.set(key, null)
    }
  }
  // Embed them, once, in a single call. Seeding the map with `null` vectors — as this did —
  // leaves `dedupeByEmbedding` with nothing to compare a new card against, so §1.2 rule 11's
  // cosine silently degrades to exact string match for exactly the cards that matter: the ones
  // an earlier run or an earlier session already wrote. A card rephrasing lesson 3's question
  // in lesson 9 is the case the threshold exists for, and it is the case a string match misses.
  if (deps.embeddings !== undefined && existingFronts.size > 0) {
    const keys = [...existingFronts.keys()]
    let embedded = 0
    try {
      const vectors = await deps.embeddings.embed(keys)
      for (const [index, key] of keys.entries()) {
        const vector = vectors[index]
        if (vector !== undefined) {
          existingFronts.set(key, vector)
          embedded += 1
        }
      }
    } catch {
      // A provider that cannot answer is not a reason to fail an expansion: the dedupe falls
      // back to the exact front, which is what an unwired provider gives, and the run says so.
      embedded = 0
    }
    // Throwing is not the only way a provider fails. One that answers with fewer vectors than
    // it was asked for — an adapter that turns "no model downloaded" into an empty array, say —
    // leaves every front on `null`, which makes `dedupeByEmbedding` skip every comparison and
    // silently demotes rule 11's cosine to the exact string match it exists to beat. Reporting
    // only the `throw` meant that failure was the one nothing said a word about.
    if (embedded === 0) warnings.push(warning('embeddings_unavailable', { stage: 'expand' }))
  }
  if (deps.embeddings === undefined) {
    warnings.push(warning('embeddings_unavailable', { stage: 'expand' }))
  }

  const importanceFloor: ImportanceLevel | null = importanceFloorOf(input.config)
  const targetLanguage = targetLanguageOf(input.config, input.draft)
  const theoryBinding = expansionBinding(deps.prompts.lesson, WRITE_LESSON_STAGE, {
    allowOverBudget: input.allowOverBudget,
    ...(input.regenerate === true ? { force: true } : {}),
  })
  const cardsBinding = expansionBinding(deps.prompts.flashcards, MAKE_FLASHCARDS_STAGE, {
    allowOverBudget: input.allowOverBudget,
    ...(input.regenerate === true ? { force: true } : {}),
  })

  // §3 stage 7's cache breakpoint. Built once for the whole path and reused by every P3 call,
  // which is the only way a provider can match it: the prefix is compared byte for byte from
  // the start, so it has to hold exactly the material that does not change between lessons.
  const [cacheTarget] = resolveTargets(deps.prompts.lesson.role, await deps.registry())
  const theoryPrefix =
    cacheTarget === undefined
      ? undefined
      : buildLessonPrefix(
          systemFor(deps.prompts.lesson.template),
          {
            draft: input.draft,
            glossary: [...input.concepts.values()]
              .map((concept) => ({
                conceptId: concept.id,
                name: concept.name,
                definition: concept.definition,
              }))
              // Sorted, because a Map's order is insertion order and a prefix whose bytes
              // depend on how the graph happened to be loaded would miss the cache.
              .sort((a, b) => a.conceptId.localeCompare(b.conceptId)),
          },
          {
            profile: cacheTarget.profile,
            modelId: cacheTarget.modelId,
            ...(deps.countTokens === undefined ? {} : { countTokens: deps.countTokens }),
          },
        )
  if (theoryPrefix?.injectionSuspected === true) {
    warnings.push(warning('expansion_injection_suspected', { stage: WRITE_LESSON_STAGE }))
  }
  const prefixOptions =
    theoryPrefix === undefined
      ? {}
      : {
          system: theoryPrefix.system,
          cachePrefix: theoryPrefix.cachePrefix,
          ...(theoryPrefix.cache === undefined ? {} : { cache: theoryPrefix.cache }),
        }

  const theoryRequestFor = (entry: Prepared) =>
    buildTheoryRequest(
      {
        lesson: entry.plan.node,
        context: entry.context,
        config: input.config,
        targetLanguage,
        minutes: entry.plan.node.estimated_minutes,
      },
      deps.prompts.lesson,
      entry.revision,
      {
        ...prefixOptions,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
    )

  const waveDeps = {
    ai: deps.ai,
    ...(deps.runner === undefined ? {} : { runner: deps.runner }),
    ...(deps.resultCache === undefined ? {} : { resultCache: deps.resultCache }),
    clock: deps.clock,
    timers: deps.timers,
    logger: deps.logger,
    concurrency: concurrency.lessons,
  }

  const report = (stage: GenerationStage, done: number, total: number, specId?: string): void => {
    deps.onProgress?.({
      runId: input.runId,
      stage,
      done,
      total,
      ...(specId === undefined ? {} : { lessonSpecId: specId }),
    })
  }

  /** Fires once per lesson whose row moved, so the panel redraws one line rather than all. */
  const reportLesson = async (
    plan: LessonPlan,
    status: LessonStatus,
    qa?: LessonQaSummary,
  ): Promise<void> => {
    if (deps.onLesson === undefined) return
    const [activities, items] = await Promise.all([
      deps.repos.paths.listActivities(plan.lessonId),
      deps.repos.knowledgeItems.listByLesson(plan.lessonId),
    ])
    deps.onLesson({
      runId: input.runId,
      pathVersionId: input.pathVersionId,
      lessonId: plan.lessonId,
      specId: plan.specId,
      status,
      activities: activities.length,
      flashcards: items.length,
      ...(qa === undefined ? {} : { qa }),
    })
  }

  // Stage 8 takes over from the cards when it is wired: `qa` is "written, not yet through
  // §5's gates" and `ready` is the gates' verdict. Without the gates, the cards are the end.
  const landed: LessonStatus = deps.qa === undefined ? 'ready' : 'qa'

  const failLesson = async (entry: Prepared, error: string): Promise<void> => {
    failed.push({ lesson: entry.plan.specId, error })
    warnings.push(warning('lesson_failed', { lesson: entry.plan.specId, error }))
    await markLesson(deps.repos, entry.plan, 'failed', {
      ...entry.plan.expansion,
      run_id: input.runId,
      revision: entry.revision,
    })
    await reportLesson(entry.plan, 'failed')
  }

  /** P3 for a group of lessons, then the theory is on the row and P4/P5 can be built. */
  const runTheory = async (entries: readonly Prepared[], userWaiting: boolean): Promise<void> => {
    if (entries.length === 0) return
    const requests = entries.map(theoryRequestFor)
    for (const [index, entry] of entries.entries()) {
      if ((requests[index] as (typeof requests)[number]).injectionSuspected) {
        warnings.push(
          warning('expansion_injection_suspected', {
            lesson: entry.plan.specId,
            block: 'sources',
          }),
        )
      }
    }
    let done = 0
    report('expanding_theory', 0, entries.length)

    const result = await runWave<WriteLessonOutput>(
      {
        ...waveDeps,
        onBatch: deps.onBatch,
        onPoll: (batch) => {
          deps.onProgress?.({
            runId: input.runId,
            stage: 'expanding_theory',
            done,
            total: entries.length,
            batchId: batch.id,
          })
        },
      },
      {
        requests,
        binding: theoryBinding,
        userWaiting,
        allowOverBudget: input.allowOverBudget,
        ...(input.budget === undefined ? {} : { budget: input.budget }),
        ...(input.perCallEstimateUsd === undefined
          ? {}
          : { perCallEstimateUsd: input.perCallEstimateUsd }),
        ...(input.batchIds === undefined ? {} : { batchIds: input.batchIds }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
      async ({ index, value, model }) => {
        const entry = entries[index] as Prepared
        const request = requests[index] as (typeof requests)[number]
        const resolved = resolveCitations(value, entry.context, entry.plan.specId)
        warnings.push(...resolved.warnings)
        const theory: LessonTheory = {
          version: 1,
          blocks: [...resolved.blocks],
          glossary: value.glossary,
          word_count: value.word_count,
        }
        entry.theory = { output: value, customId: request.customId, model }
        entry.resolved = { theory, citations: resolved.citations }
        entry.plan.expansion.p3 = {
          custom_id: request.customId,
          at: deps.clock.now().toISOString(),
          model,
          word_count: value.word_count,
        }
        entry.plan.expansion.citations = {
          resolved: resolved.citations.length,
          dropped: resolved.dropped.length,
          uncited_blocks: resolved.uncited,
        }
        entry.plan.expansion.revision = entry.revision
        entry.plan.expansion.run_id = input.runId
        await persistTheory(deps.repos, {
          plan: entry.plan,
          theory,
          citations: resolved.citations,
          expansion: entry.plan.expansion,
          status: 'generating',
        })
        done += 1
        report('expanding_theory', done, entries.length, entry.plan.specId)
      },
    )
    accrue(totals, result, WRITE_LESSON_STAGE)
    worsen(result.status)
    for (const failure of result.failed) {
      const index = requests.findIndex((request) => request.customId === failure.customId)
      const entry = entries[index]
      if (entry !== undefined) await failLesson(entry, failure.error)
    }
  }

  /** P4 for a group of lessons whose theory has landed: one call per allowed family. */
  const runPractice = async (entries: readonly Prepared[], userWaiting: boolean): Promise<void> => {
    const ready = entries.filter((entry) => entry.theory !== undefined)
    if (ready.length === 0) return

    const authorRequestFor = async (entry: Prepared): Promise<ActivityAuthorRequest> => {
      const families = familiesFor(entry.plan.concepts.map((concept) => concept.kind))
      return {
        lessonSpecId: entry.plan.specId,
        parentCustomId: (entry.theory as NonNullable<Prepared['theory']>).customId,
        lang: input.config.lessonLanguage,
        title: entry.plan.node.title,
        objectives: entry.plan.node.objectives,
        concepts: entry.plan.concepts.map((concept) => ({
          id: concept.id,
          name: concept.name,
          definition: concept.definition,
        })),
        blocks: (entry.theory as NonNullable<Prepared['theory']>).output.blocks.map((block) => ({
          type: block.type,
          content: block.content,
        })),
        misconceptions: entry.plan.misconceptions,
        families,
        // §7 asks for "2–3× the needed count" *for the lesson*, and `plan` makes one call per
        // family asking for `wanted × overGeneration` each. So the lesson's block has to be
        // divided across the families before it is multiplied: passing the whole block as
        // `wanted` would ask each of up to six families for 16 candidates and buy ~96 for a
        // block of at most 8. Dividing first lands between 2× and 3× overall, and the ceiling
        // keeps every family contributing at least two so the composer still has a choice to
        // make on type and family variety.
        wanted: Math.ceil(LESSON_PRACTICE_LIMITS.max / Math.max(families.length, 1)),
        overGeneration: 2,
        alreadyGenerated:
          input.moreExamples === true
            ? (await deps.repos.paths.listActivities(entry.plan.lessonId)).flatMap((activity) => {
                const config = activity.config as { prompt?: unknown }
                return typeof config.prompt === 'string' ? [config.prompt] : []
              })
            : [],
        variant: (entry.plan.expansion.variants.all ?? 0) + (input.moreExamples === true ? 1 : 0),
      }
    }

    const flat: { entry: Prepared; call: ReturnType<ExpandDeps['author']['plan']>[number] }[] = []
    for (const entry of ready) {
      const request = await authorRequestFor(entry)
      for (const call of deps.author.plan(
        request,
        input.signal === undefined ? {} : { signal: input.signal },
      )) {
        flat.push({ entry, call })
      }
    }
    if (flat.length === 0) return

    const pools = new Map<
      string,
      Awaited<ReturnType<ExpandDeps['author']['collect']>>['activities'][number][]
    >()
    const customIds = new Map<string, Record<string, string>>()
    for (const { entry, call } of flat) {
      const byFamily = customIds.get(entry.plan.specId) ?? {}
      byFamily[call.family] = call.customId
      customIds.set(entry.plan.specId, byFamily)
      if (call.injectionSuspected) {
        warnings.push(
          warning('expansion_injection_suspected', {
            lesson: entry.plan.specId,
            block: 'activities',
          }),
        )
      }
    }

    let done = 0
    report('expanding_practice', 0, flat.length)
    const result = await runWave<unknown>(
      {
        ...waveDeps,
        concurrency: concurrency.families,
        onBatch: deps.onBatch,
        onPoll: (batch) => {
          deps.onProgress?.({
            runId: input.runId,
            stage: 'expanding_practice',
            done,
            total: flat.length,
            batchId: batch.id,
          })
        },
      },
      {
        requests: flat.map(({ call }) => call),
        binding: expansionBinding(deps.prompts.activities, 'P4_make_activities', {
          allowOverBudget: input.allowOverBudget,
          ...(input.regenerate === true ? { force: true } : {}),
        }),
        userWaiting,
        allowOverBudget: input.allowOverBudget,
        ...(input.budget === undefined ? {} : { budget: input.budget }),
        ...(input.perCallEstimateUsd === undefined
          ? {}
          : { perCallEstimateUsd: input.perCallEstimateUsd }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
      async ({ index, value }) => {
        const { entry, call } = flat[index] as (typeof flat)[number]
        const collected = deps.author.collect(call, value)
        for (const rejection of collected.rejected) {
          warnings.push(
            warning('activity_rejected', {
              lesson: entry.plan.specId,
              type: rejection.type,
              code: rejection.code,
            }),
          )
        }
        const pool = pools.get(entry.plan.specId) ?? []
        pool.push(...collected.activities)
        pools.set(entry.plan.specId, pool)
        done += 1
        report('expanding_practice', done, flat.length, entry.plan.specId)
      },
    )
    accrue(totals, result, 'P4_make_activities')
    worsen(result.status)
    for (const failure of result.failed) {
      const entry = flat.find(({ call }) => call.customId === failure.customId)?.entry
      // A family that failed is a thinner pool, not a failed lesson: the block is composed
      // from what did come back, and `practice_incomplete` reports what it could not meet.
      if (entry !== undefined) {
        warnings.push(
          warning('activity_rejected', {
            lesson: entry.plan.specId,
            type: 'call',
            code: failure.error,
          }),
        )
      }
    }

    for (const entry of ready) {
      const pool = pools.get(entry.plan.specId) ?? []
      const composed = composePractice(
        pool,
        entry.plan.specId,
        `${input.pathVersionId}:${entry.plan.specId}:${entry.revision}`,
      )
      warnings.push(...composed.warnings)
      entry.plan.expansion.p4 = {
        at: deps.clock.now().toISOString(),
        model: (entry.theory as NonNullable<Prepared['theory']>).model,
        custom_ids: customIds.get(entry.plan.specId) ?? {},
        generated: composed.generated,
        kept: composed.kept,
        unmet: composed.unmet.map((rule) => ({ rule: rule.rule, detail: rule.detail })),
      }
      if (input.moreExamples === true) {
        entry.plan.expansion.variants = {
          ...entry.plan.expansion.variants,
          all: (entry.plan.expansion.variants.all ?? 0) + 1,
        }
      }
      const created = await persistPractice(deps.repos, {
        plan: entry.plan,
        rows: composed.rows,
        expansion: entry.plan.expansion,
        status: 'generating',
        replace: input.regenerate === true || input.moreExamples !== true,
      })
      totals.activities += created.length
    }
  }

  /** P5 for a group of lessons whose theory has landed, then the memory items. */
  const runCards = async (entries: readonly Prepared[], userWaiting: boolean): Promise<void> => {
    const landedEntries = entries.filter((entry) => entry.theory !== undefined)
    if (landedEntries.length === 0) return

    // A lesson whose items already exist is never re-written (see below), so it is not asked
    // for cards either. Until this, every "Regenerar" — and every regeneration the gates ask
    // for — built and paid for a P5 whose answer was then thrown away.
    const ready: Prepared[] = []
    for (const entry of landedEntries) {
      const already = await deps.repos.knowledgeItems.listByLesson(entry.plan.lessonId)
      // Cards a regeneration carried over (8.6) cover only the concepts they are about: a lesson
      // that gained one still gets P5 for it (`needsFlashcards`).
      if (needsFlashcards(already, entry.plan.node.concept_ids)) {
        ready.push(entry)
        continue
      }
      await markLesson(deps.repos, entry.plan, landed, entry.plan.expansion)
      await reportLesson(entry.plan, landed)
    }
    if (ready.length === 0) return

    const requests = ready.map((entry) => {
      const theory = entry.theory as NonNullable<Prepared['theory']>
      return buildFlashcardRequest(
        {
          lessonSpecId: entry.plan.specId,
          title: entry.plan.node.title,
          lang: input.config.lessonLanguage,
          blocks: theory.output.blocks,
          glossary: glossaryOf(entry.plan),
          context: entry.context,
          existingFronts: [...existingFronts.keys()],
        },
        theory.customId,
        deps.prompts.flashcards,
        input.signal === undefined ? {} : { signal: input.signal },
      )
    })

    let done = 0
    report('expanding_flashcards', 0, ready.length)
    const result = await runWave<MakeFlashcardsOutput>(
      {
        ...waveDeps,
        onBatch: deps.onBatch,
        onPoll: (batch) => {
          deps.onProgress?.({
            runId: input.runId,
            stage: 'expanding_flashcards',
            done,
            total: ready.length,
            batchId: batch.id,
          })
        },
      },
      {
        requests,
        binding: cardsBinding,
        userWaiting,
        allowOverBudget: input.allowOverBudget,
        ...(input.budget === undefined ? {} : { budget: input.budget }),
        ...(input.perCallEstimateUsd === undefined
          ? {}
          : { perCallEstimateUsd: input.perCallEstimateUsd }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
      async ({ index, value, model }) => {
        const entry = ready[index] as Prepared
        const mapped = toMemoryItems({
          lessonSpecId: entry.plan.specId,
          flashcards: value.flashcards,
          context: entry.context,
          primaryConceptId: entry.plan.node.concept_ids[0] ?? null,
          existing: existingFronts,
          importanceFloor,
          now: deps.clock.now(),
        })
        warnings.push(...mapped.warnings)

        let drafts = mapped.drafts
        let deduped = mapped.deduped
        if (deps.embeddings !== undefined) {
          const pass = await dedupeByEmbedding(
            drafts,
            existingFronts,
            deps.embeddings,
            entry.plan.specId,
          )
          warnings.push(...pass.warnings)
          drafts = pass.kept
          deduped += pass.deduped
          for (const [key, vector] of pass.vectors) existingFronts.set(key, vector)
        }
        for (const draft of drafts) {
          if (!existingFronts.has(draft.key)) existingFronts.set(draft.key, null)
        }

        // §4 item 9 asks for three to eight. The floor is not enforced — padding to a quota is
        // §14 pitfall 4, and §1.3's material legitimately yields none — but a lesson that gives
        // the memory system almost nothing is worth saying out loud, because the two innocent
        // causes (a lesson of pure procedure, a lesson whose cards the path already had) and
        // the one bad cause (P5 gave up) are indistinguishable from the row count alone.
        if (drafts.length < MIN_FLASHCARDS_PER_LESSON) {
          warnings.push(
            warning('flashcards_thin', {
              lesson: entry.plan.specId,
              kept: drafts.length,
              generated: value.flashcards.length,
              deduped,
            }),
          )
        }

        entry.plan.expansion.p5 = {
          custom_id: (requests[index] as (typeof requests)[number]).customId,
          at: deps.clock.now().toISOString(),
          model,
          generated: value.flashcards.length,
          kept: drafts.length,
          deduped,
        }
        // A lesson whose items already exist is never re-written — it was not even asked for
        // cards, above. That is what makes a resume free — "created exactly once per
        // flashcard" is a property of the stage — and it is also what "Regenerar" must do: a
        // card the learner has already reviewed carries FSRS state, and replacing the row
        // would throw away the stability and difficulty they earned. Rewriting the theory
        // does not invalidate what they remember. §11's remediation policy takes the same
        // line: it *reuses* a concept's cards and only adds a contrast card.
        const written = await persistFlashcards(deps.repos, {
          plan: entry.plan,
          drafts,
          expansion: entry.plan.expansion,
          status: landed,
        })
        totals.flashcards += written
        done += 1
        report('expanding_flashcards', done, ready.length, entry.plan.specId)
        await reportLesson(entry.plan, landed)
      },
    )
    accrue(totals, result, MAKE_FLASHCARDS_STAGE)
    worsen(result.status)
    for (const failure of result.failed) {
      const index = requests.findIndex((request) => request.customId === failure.customId)
      const entry = ready[index]
      if (entry !== undefined) await failLesson(entry, failure.error)
    }
  }

  /**
   * Stage 8 for a group whose cards have landed: the gates, the verdict, and — for a lesson
   * under §5's thresholds that may still have it — the one regeneration.
   */
  const runQa = async (entries: readonly Prepared[], userWaiting: boolean): Promise<void> => {
    const qa = deps.qa
    if (qa === undefined) return
    const ready = entries.filter(
      (entry) => entry.theory !== undefined && entry.resolved !== undefined,
    )
    if (ready.length === 0 || stopped()) return

    const lessons: QaLessonInput[] = ready.map((entry) => {
      const theory = entry.theory as NonNullable<Prepared['theory']>
      const resolved = entry.resolved as NonNullable<Prepared['resolved']>
      return {
        lessonId: entry.plan.lessonId,
        specId: entry.plan.specId,
        moduleId: entry.plan.moduleId,
        title: entry.plan.node.title,
        objectives: entry.plan.node.objectives,
        concepts: entry.plan.concepts,
        misconceptions: entry.plan.misconceptions,
        theory: resolved.theory,
        citations: resolved.citations,
        p3CustomId: theory.customId,
        generatorModel: theory.model,
        attempt: entry.qaAttempt,
        variantRounds: entry.plan.expansion.variants.all ?? 0,
      }
    })

    const result = await qa.run({
      runId: input.runId,
      pathVersionId: input.pathVersionId,
      lessonLanguage: input.config.lessonLanguage,
      mode: input.config.qaMode,
      lessons,
      userWaiting,
      allowOverBudget: input.allowOverBudget,
      // "Más ejemplos" did not touch the theory, so a verdict under the threshold is not a
      // reason to rewrite it — the lesson is flagged and the user decides.
      allowRegenerate: input.moreExamples !== true,
      ...(input.budget === undefined ? {} : { budget: input.budget }),
      ...(input.perCallEstimateUsd === undefined
        ? {}
        : { perCallEstimateUsd: input.perCallEstimateUsd }),
      ...(input.batchIds === undefined ? {} : { batchIds: input.batchIds }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      onProgress: (progress) => deps.onProgress?.(progress),
      ...(deps.onBatch === undefined ? {} : { onBatch: deps.onBatch }),
    })
    accrue(totals, result)
    for (const [stage, models] of Object.entries(result.modelsByStage)) {
      mergeModelsByStage(totals, stage, models)
    }
    worsen(result.status)
    warnings.push(...result.warnings)
    // A wave that paused on the budget or was cancelled left some lesson unverified, and a
    // verdict written now would be the last word on it: nothing is persisted, every lesson
    // stays in `qa`, and the resume replays what was answered from `ai_results` for free.
    if (stopped()) return

    const again: Prepared[] = []
    for (const outcome of result.outcomes) {
      const entry = ready.find((candidate) => candidate.plan.lessonId === outcome.lessonId)
      if (entry === undefined) continue
      if (outcome.regenerate && !stopped()) {
        warnings.push(warning('lesson_regenerated', { lesson: entry.plan.specId }))
        again.push({
          plan: entry.plan,
          context: entry.context,
          revision: entry.revision + 1,
          qaAttempt: entry.qaAttempt + 1,
        })
        continue
      }
      await persistQa(deps.repos, {
        lessonId: entry.plan.lessonId,
        theory: outcome.theory,
        citations: outcome.citations,
        qa: outcome.qa,
        duplicateActivityIds: outcome.duplicateActivityIds,
      })
      if (outcome.qa.reviewed) totals.qa.reviewed += 1
      if (outcome.qa.verdict === 'fixed') totals.qa.fixed += 1
      if (outcome.qa.verdict === 'regenerated') totals.qa.regenerated += 1
      if (outcome.qa.verdict === 'flagged') totals.qa.flagged += 1
      await reportLesson(entry.plan, 'ready', summarizeQa(outcome.qa))
    }

    if (again.length === 0 || stopped()) return
    // The one regeneration §5 allows: P3 again at the next revision, P4 replaced, the cards
    // kept (they are never rewritten), and the gates once more with `attempt: 1`. The
    // counter goes on the ledger *before* P3 lands, so a process that dies here resumes into
    // "already regenerated once" rather than into a third rewrite.
    for (const entry of again) {
      entry.plan.expansion.qa_regenerations = entry.qaAttempt
      entry.plan.expansion.revision = entry.revision
      await markLesson(deps.repos, entry.plan, 'generating', entry.plan.expansion)
      await reportLesson(entry.plan, 'generating')
    }
    await runTheory(again, userWaiting)
    if (stopped()) return
    await runPractice(again, userWaiting)
    if (stopped()) return
    await runCards(again, userWaiting)
    if (stopped()) return
    await runQa(again, userWaiting)
  }

  /** P3, then P4, then P5, then the gates, for one group of lessons. */
  const runGroup = async (entries: readonly Prepared[], userWaiting: boolean): Promise<void> => {
    if (entries.length === 0 || stopped()) return
    // The row moves to `generating` when P3 starts (`persistTheory`), but only `ready` and
    // `failed` were ever pushed — so a panel watching `pathgen.lessonStatus` showed a lesson as
    // queued right up until it was finished, and the tail of a batched path looked stalled for
    // as long as the batch took. Announced here rather than per stage: one event per lesson.
    for (const entry of entries) await reportLesson(entry.plan, 'generating')
    await runTheory(entries, userWaiting)
    if (stopped()) return
    await runPractice(entries, userWaiting)
    if (stopped()) return
    await runCards(entries, userWaiting)
    if (stopped()) return
    await runQa(entries, userWaiting)
  }

  // The head is a whole pipeline run synchronously, so the learner has a *complete* lesson —
  // theory, practice and cards — rather than a lesson missing its exercises (§3 stage 7,
  // §14 pitfall 18). The tail goes through the Batch API at half price.
  const head = prepared.slice(0, SYNCHRONOUS_HEAD_LESSONS)
  const tail = prepared.slice(SYNCHRONOUS_HEAD_LESSONS)
  await runGroup(head, true)
  await runGroup(tail, input.userWaiting)

  const finished = await Promise.all(
    prepared.map(async (entry) => (await deps.repos.paths.findLesson(entry.plan.lessonId))?.status),
  )
  const expanded = finished.filter((state) => state === 'ready').length
  const pending = finished.filter((state) => state !== 'ready' && state !== 'failed').length

  return {
    status,
    expanded,
    reused,
    cacheHits: totals.cacheHits,
    calls: totals.calls,
    activities: totals.activities,
    flashcards: totals.flashcards,
    failed,
    pending,
    warnings: dedupeWarnings(warnings),
    usage: totals.usage,
    batchIds: [...new Set(totals.batchIds)],
    modelsUsed: [...totals.models].sort(),
    modelsByStage: Object.fromEntries(
      [...totals.modelsByStage].map(([stage, models]) => [stage, [...models].sort()]),
    ),
    qa: { ...totals.qa },
  }
}
