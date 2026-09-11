import type {
  AiClient,
  AiRegistry,
  AiResultCache,
  BatchRunner,
  RoleTarget,
  Timers,
} from '@retenia/ai'
import { resolveTargets } from '@retenia/ai'
import type {
  AbortSignalLike,
  Activity,
  ChunkRepository,
  Clock,
  EmbeddingProvider,
  KnowledgeItemRepository,
  PathRepository,
} from '@retenia/core'
import type { BudgetGuard } from '../budget'
import type { ConceptFacts } from '../expand/plan'
import { expansionBinding } from '../expand/requests'
import { runWave, type WaveResult, type WaveStatus } from '../expand/wave'
import type { PathgenLogger } from '../logger'
import type { GenerationStage } from '../progress/stages'
import type { PathgenPrompt, PathgenPrompts } from '../prompts'
import type { LessonCitation, LessonTheory, TheoryBlock } from '../schemas/lesson'
import type { JudgeCriterion } from '../schemas/qa'
import { dedupeWarnings, type GenerationWarning, warning } from '../schemas/warnings'
import { addUsage, type StageUsage, ZERO_USAGE } from '../usage'
import { type Claim, extractClaims } from './claims'
import { checkCitations } from './gates/citations'
import { checkCoverage } from './gates/coverage'
import { checkDuplicates, type DuplicateItem, type DuplicatePair } from './gates/duplicates'
import { applyEdits } from './gates/edit'
import { applyFaithfulness, FAITHFULNESS_PASS, FAITHFULNESS_REGENERATE } from './gates/faithfulness'
import { applyJudge, JUDGE_REGENERATE } from './gates/judge'
import { checkLanguage } from './gates/language'
import { checkLength } from './gates/length'
import { checkSchema } from './gates/schema'
import type { EditInstruction, GateResult } from './gates/types'
import { checkVariety, VARIETY_LIMITS } from './gates/variety'
import {
  LESSON_QA_VERSION,
  type LessonQa,
  MAX_FINDINGS,
  QA_GATES,
  type QaFinding,
  type QaGate,
  type QaGateOutcome,
  type QaMode,
  type QaVerdict,
} from './lesson-qa'
import {
  buildEditRequest,
  buildFaithfulnessRequest,
  buildJudgeRequest,
  EDIT_LESSON_STAGE,
  FAITHFULNESS_STAGE,
  PEDAGOGY_JUDGE_STAGE,
  type QaRequest,
} from './requests'

/**
 * Stage 8 of `docs/spec/04-path-generation.md` §3 — the QA gates of §5, run over a group
 * of lessons stage 7 has just finished, in the order §5 lists them and with the thresholds
 * it states.
 *
 * The shape is the one `expand/expand-lessons.ts` gave stage 7: the gates that need a
 * model are **waves** (`runWave`: replay from `ai_results`, then the Batch API at half price
 * when nobody is waiting, then a synchronous fallback), one after the other because they
 * spend from the same budget guard, and everything between the waves is pure code over the
 * lesson's blocks. Four waves at most — P6, P7, P8, and the one P6 re-run §5 gate 10 allows
 * after the edit — and in light mode only the first.
 *
 * What comes back is a verdict per lesson and the *edited* theory and citations that go
 * with it, for the caller to persist in one write. Nothing here touches the database except
 * to read: a lesson's row changes exactly once, at the end, or not at all.
 *
 * Three rules the caller relies on. A lesson that asks for a regeneration is returned with
 * `regenerate: true` and no persistence is expected of it; the caller runs P3 again and
 * calls back with `attempt: 1`, at which point a second failure is a `flagged` verdict and
 * never another rewrite. A wave that fails for one lesson fails that lesson's QA, not the
 * run: it is returned `flagged`, `reviewed: false`, with `qa_failed` naming the gate. And a
 * lesson whose text P6 never answered for — the run stopped before its wave, or after P8
 * rewrote it and before the re-verification — is `reviewed: false` too, with the pre-edit
 * text: an unverified rewrite is never handed back as a `fixed` lesson, and a paused run
 * (`status` other than `completed`) is one the caller should not persist at all.
 */

export const DEFAULT_QA_CONCURRENCY = 2

export interface QaRepos {
  readonly paths: Pick<PathRepository, 'listActivities' | 'loadTree'>
  readonly chunks: Pick<ChunkRepository, 'findMany'>
  readonly knowledgeItems: Pick<KnowledgeItemRepository, 'listByLesson'>
}

export interface QaPipelineDeps {
  readonly ai: Pick<AiClient, 'structured'>
  /** To resolve the `judge` role's targets for the bias guard. */
  readonly registry: () => Promise<AiRegistry>
  readonly runner?: Pick<BatchRunner, 'runJob' | 'poll' | 'list' | 'cancel'>
  readonly resultCache?: Pick<AiResultCache, 'get'>
  readonly prompts: Pick<PathgenPrompts, 'faithfulness' | 'judge' | 'edit'>
  readonly repos: QaRepos
  readonly embeddings?: Pick<EmbeddingProvider, 'embed'>
  /** `@retenia/ingest`'s detector, wired by main; absent means gate (h)'s language half is skipped. */
  readonly detectLanguage?: (text: string) => string | null
  readonly clock: Clock
  readonly timers: Pick<Timers, 'sleep'>
  readonly logger: PathgenLogger
  readonly concurrency?: number
}

export interface QaLessonInput {
  readonly lessonId: string
  readonly specId: string
  readonly moduleId: string
  readonly title: string
  readonly objectives: readonly { readonly text: string; readonly bloom: string }[]
  readonly concepts: readonly ConceptFacts[]
  readonly misconceptions: readonly {
    readonly id: string
    readonly text: string
    readonly whyWrong: string
  }[]
  readonly theory: LessonTheory
  readonly citations: readonly LessonCitation[]
  /** The P3 call that wrote the theory — every QA call is parented on it. */
  readonly p3CustomId: string
  /** The model that wrote the theory — what the judge must not be. */
  readonly generatorModel: string
  /** `0` on the first pass, `1` after the one regeneration the sub-phase allows. */
  readonly attempt: number
  /** How many "Más ejemplos" rounds the practice block has had (`expansion.variants.all`). */
  readonly variantRounds?: number
}

export interface QaProgress {
  readonly runId: string
  readonly stage: GenerationStage
  readonly done: number
  readonly total: number
  readonly lessonSpecId?: string
  readonly batchId?: string
}

export interface QaRunInput {
  readonly runId: string
  readonly pathVersionId: string
  readonly lessonLanguage: string
  readonly mode: QaMode
  readonly lessons: readonly QaLessonInput[]
  readonly userWaiting: boolean
  readonly allowOverBudget: boolean
  /** Whether a lesson under the thresholds may go back to P3 — false on "Más ejemplos". */
  readonly allowRegenerate: boolean
  readonly budget?: BudgetGuard
  readonly perCallEstimateUsd?: number
  /** Batches a previous attempt of this run left in flight. */
  readonly batchIds?: readonly string[]
  readonly signal?: AbortSignalLike
  readonly onProgress?: (progress: QaProgress) => void
  readonly onBatch?: (batchId: string) => void | Promise<void>
}

export interface QaLessonOutcome {
  readonly lessonId: string
  readonly specId: string
  readonly qa: LessonQa
  readonly theory: LessonTheory
  readonly citations: readonly LessonCitation[]
  /** Below §5's thresholds and allowed one more P3: the caller regenerates instead of persisting. */
  readonly regenerate: boolean
  /** Activities to soft-delete at the verdict — duplicates the block can spare. */
  readonly duplicateActivityIds: readonly string[]
}

export interface QaRunResult {
  readonly status: WaveStatus
  readonly outcomes: readonly QaLessonOutcome[]
  readonly usage: StageUsage
  readonly cacheHits: number
  readonly calls: number
  readonly batchIds: readonly string[]
  readonly modelsUsed: readonly string[]
  readonly warnings: readonly GenerationWarning[]
}

export interface QaPipeline {
  run(input: QaRunInput): Promise<QaRunResult>
}

interface LessonState {
  readonly input: QaLessonInput
  blocks: TheoryBlock[]
  citations: LessonCitation[]
  claims: Claim[]
  activities: Activity[]
  readonly gates: Map<QaGate, QaGateOutcome>
  readonly findings: Map<QaGate, QaFinding[]>
  readonly edits: Map<QaGate, EditInstruction[]>
  readonly warnings: GenerationWarning[]
  faithfulness: number | null
  pedagogy: number | null
  criteria: { readonly id: JudgeCriterion; readonly score: number }[]
  coverageOk: boolean
  duplicates: DuplicatePair[]
  usage: StageUsage
  calls: number
  cacheHits: number
  readonly models: { p6: string | null; p7: string | null; p8: string | null }
  editIterations: number
  /** An edit pass ran *and* changed a block — what makes the verdict `fixed`. */
  editApplied: boolean
  /** The text as it stood before P8 changed it, kept until P6 has answered for the new one. */
  preEdit: {
    readonly blocks: TheoryBlock[]
    readonly citations: LessonCitation[]
    readonly gates: Map<QaGate, QaGateOutcome>
    readonly findings: Map<QaGate, QaFinding[]>
    readonly edits: Map<QaGate, EditInstruction[]>
  } | null
  failed: boolean
}

interface Pending<T> {
  readonly state: LessonState
  readonly request: QaRequest<T>
}

function absorb(state: LessonState, result: GateResult): void {
  state.gates.set(result.gate, result.outcome)
  state.findings.set(result.gate, [...result.findings])
  state.edits.set(result.gate, [...result.edits])
  state.warnings.push(...result.warnings)
}

/** What a knowledge item asks, as one string — the same rule stage 7's dedupe uses. */
function frontOfItem(fields: unknown): string {
  const item = fields as { front?: unknown; cloze_text?: unknown; context_cue?: unknown }
  if (typeof item.cloze_text === 'string') return item.cloze_text
  const cue = typeof item.context_cue === 'string' ? `${item.context_cue} ` : ''
  return `${cue}${typeof item.front === 'string' ? item.front : ''}`
}

function promptOf(activity: Activity): string {
  const config = activity.config as { prompt?: unknown }
  return typeof config.prompt === 'string' ? config.prompt : ''
}

export function createQaPipeline(deps: QaPipelineDeps): QaPipeline {
  return { run: (input) => runQaGates(deps, input) }
}

export async function runQaGates(deps: QaPipelineDeps, input: QaRunInput): Promise<QaRunResult> {
  const concurrency = deps.concurrency ?? DEFAULT_QA_CONCURRENCY
  const runWarnings: GenerationWarning[] = []
  const totals = {
    usage: ZERO_USAGE as StageUsage,
    calls: 0,
    cacheHits: 0,
    batchIds: [] as string[],
    models: new Set<string>(),
  }
  let status: WaveStatus = 'completed'
  const worsen = (next: WaveStatus): void => {
    if (next === 'cancelled' || (next === 'blocked_budget' && status === 'completed')) status = next
  }
  const stopped = (): boolean => status !== 'completed' || input.signal?.aborted === true
  const report = (
    stage: GenerationStage,
    done: number,
    total: number,
    specId?: string,
    batchId?: string,
  ): void => {
    input.onProgress?.({
      runId: input.runId,
      stage,
      done,
      total,
      ...(specId === undefined ? {} : { lessonSpecId: specId }),
      ...(batchId === undefined ? {} : { batchId }),
    })
  }

  const states: LessonState[] = input.lessons.map((lesson) => ({
    input: lesson,
    blocks: [...lesson.theory.blocks],
    citations: [...lesson.citations],
    claims: [],
    activities: [],
    gates: new Map(),
    findings: new Map(),
    edits: new Map(),
    warnings: [],
    faithfulness: null,
    pedagogy: null,
    criteria: [],
    coverageOk: true,
    duplicates: [],
    usage: ZERO_USAGE,
    calls: 0,
    cacheHits: 0,
    models: { p6: null, p7: null, p8: null },
    editIterations: 0,
    editApplied: false,
    preEdit: null,
    failed: false,
  }))

  // --- what every gate reads ------------------------------------------------------------
  const chunkIds = [
    ...new Set(input.lessons.flatMap((lesson) => lesson.citations.map((c) => c.chunk_id))),
  ]
  const chunkText = new Map(
    (chunkIds.length === 0 ? [] : await deps.repos.chunks.findMany(chunkIds)).map((chunk) => [
      chunk.id,
      chunk.text,
    ]),
  )

  const activitiesByLesson = new Map<string, Activity[]>()
  const activitiesOf = async (lessonId: string): Promise<Activity[]> => {
    const cached = activitiesByLesson.get(lessonId)
    if (cached !== undefined) return cached
    const rows = [...(await deps.repos.paths.listActivities(lessonId))]
    activitiesByLesson.set(lessonId, rows)
    return rows
  }

  // The rest of the path, for the duplicate and the module-level checks. Loaded once.
  const tree = await deps.repos.paths.loadTree(input.pathVersionId)
  const inGroup = new Set(input.lessons.map((lesson) => lesson.lessonId))
  const others: DuplicateItem[] = []
  const modules = new Map<string, { specId: string; lessonIds: string[] }>()
  if (tree !== undefined) {
    for (const section of tree.sections) {
      for (const module of section.modules) {
        const core = module.lessons.filter((lesson) => lesson.kind === 'core')
        modules.set(module.id, {
          specId: module.specId,
          lessonIds: core.map((lesson) => lesson.id),
        })
        for (const lesson of core) {
          if (inGroup.has(lesson.id)) continue
          for (const activity of await activitiesOf(lesson.id)) {
            others.push({
              kind: 'activity',
              id: activity.id,
              lessonSpecId: lesson.specId,
              text: promptOf(activity),
            })
          }
          for (const item of await deps.repos.knowledgeItems.listByLesson(lesson.id)) {
            others.push({
              kind: 'flashcard',
              id: item.id,
              lessonSpecId: lesson.specId,
              text: frontOfItem(item.fields),
            })
          }
        }
      }
    }
  }
  const vectors = new Map<string, Float32Array | null>()
  // The lessons of this group, as far as the loop below has gone: a fresh path submits most
  // of its lessons in one group, and a twin inside it is as much a duplicate as one outside.
  // The earlier lesson keeps its exercise; the later one is the copy.
  const earlier: DuplicateItem[] = []

  /** The gates over the text: (b), (d), (g), (h) — run before P6 and again after an edit. */
  const textGates = (state: LessonState): void => {
    const specId = state.input.specId
    const citations = checkCitations({
      lessonSpecId: specId,
      blocks: state.blocks,
      citations: state.citations,
      chunkText,
    })
    state.blocks = [...citations.blocks]
    state.citations = [...citations.citations]
    absorb(state, citations)

    const coverage = checkCoverage({
      lessonSpecId: specId,
      concepts: state.input.concepts,
      blocks: state.blocks,
      activities: state.activities,
    })
    state.coverageOk = coverage.coverageOk
    absorb(state, coverage)

    absorb(state, checkLength({ lessonSpecId: specId, blocks: state.blocks, mode: input.mode }))
    absorb(
      state,
      checkLanguage({
        lessonSpecId: specId,
        blocks: state.blocks,
        glossary: state.input.theory.glossary,
        lessonLanguage: input.lessonLanguage,
        ...(deps.detectLanguage === undefined ? {} : { detectLanguage: deps.detectLanguage }),
        mode: input.mode,
      }),
    )
  }

  // --- (a) and the pure gates -----------------------------------------------------------
  for (const state of states) {
    const specId = state.input.specId
    const schema = checkSchema(state.input.theory, specId)
    absorb(state, schema)
    if (schema.theory === null) {
      state.failed = true
      continue
    }
    state.activities = await activitiesOf(state.input.lessonId)
    textGates(state)

    const items = await deps.repos.knowledgeItems.listByLesson(state.input.lessonId)
    const own: DuplicateItem[] = [
      ...state.activities.map(
        (activity): DuplicateItem => ({
          kind: 'activity',
          id: activity.id,
          lessonSpecId: specId,
          text: promptOf(activity),
        }),
      ),
      ...items.map(
        (item): DuplicateItem => ({
          kind: 'flashcard',
          id: item.id,
          lessonSpecId: specId,
          text: frontOfItem(item.fields),
        }),
      ),
    ]
    const duplicates = await checkDuplicates({
      lessonSpecId: specId,
      own,
      others: [...others, ...earlier],
      ...(deps.embeddings === undefined ? {} : { embeddings: deps.embeddings }),
      vectors,
    })
    earlier.push(...own)
    state.duplicates = [...duplicates.duplicates]
    absorb(state, duplicates)

    const module = modules.get(state.input.moduleId)
    let moduleActivities: Activity[] | null = null
    if (module !== undefined) {
      const perLesson = await Promise.all(module.lessonIds.map(activitiesOf))
      moduleActivities = perLesson.every((rows) => rows.length > 0) ? perLesson.flat() : null
    }
    absorb(
      state,
      checkVariety({
        lessonSpecId: specId,
        activities: state.activities,
        module:
          module === undefined || moduleActivities === null
            ? null
            : { specId: module.specId, activities: moduleActivities },
        variantRounds: state.input.variantRounds ?? 0,
      }),
    )
  }

  // --- the waves ------------------------------------------------------------------------
  const accrue = (wave: WaveResult): void => {
    totals.cacheHits += wave.cacheHits
    totals.calls += wave.calls
    totals.usage = addUsage(totals.usage, wave.usage)
    totals.batchIds.push(...wave.batchIds)
    for (const model of wave.modelsUsed) totals.models.add(model)
  }

  const dispatch = async <T>(
    stage: GenerationStage,
    promptStage: string,
    prompt: PathgenPrompt,
    pending: readonly Pending<T>[],
    first: boolean,
    onAnswer: (pending: Pending<T>, value: T, model: string) => void,
  ): Promise<void> => {
    if (pending.length === 0 || stopped()) return
    for (const entry of pending) {
      if (entry.request.injectionSuspected) {
        entry.state.warnings.push(
          warning('expansion_injection_suspected', {
            lesson: entry.state.input.specId,
            block: promptStage,
          }),
        )
      }
    }
    let done = 0
    report(stage, 0, pending.length)
    const result = await runWave<T>(
      {
        ai: deps.ai,
        ...(deps.runner === undefined ? {} : { runner: deps.runner }),
        ...(deps.resultCache === undefined ? {} : { resultCache: deps.resultCache }),
        clock: deps.clock,
        timers: deps.timers,
        logger: deps.logger,
        concurrency,
        ...(input.onBatch === undefined ? {} : { onBatch: input.onBatch }),
        onPoll: (batch) => report(stage, done, pending.length, undefined, batch.id),
      },
      {
        requests: pending.map((entry) => entry.request),
        binding: expansionBinding(prompt, promptStage, { allowOverBudget: input.allowOverBudget }),
        userWaiting: input.userWaiting,
        allowOverBudget: input.allowOverBudget,
        ...(input.budget === undefined ? {} : { budget: input.budget }),
        ...(input.perCallEstimateUsd === undefined
          ? {}
          : { perCallEstimateUsd: input.perCallEstimateUsd }),
        // Batches a previous attempt left in flight are awaited once, by the first wave.
        ...(first && input.batchIds !== undefined ? { batchIds: input.batchIds } : {}),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
      async (answer) => {
        const entry = pending[answer.index] as Pending<T>
        if (answer.how === 'call') entry.state.calls += 1
        else entry.state.cacheHits += 1
        entry.state.usage = addUsage(entry.state.usage, answer.usage)
        onAnswer(entry, answer.value, answer.model)
        done += 1
        report(stage, done, pending.length, entry.state.input.specId)
      },
    )
    accrue(result)
    worsen(result.status)
    for (const failure of result.failed) {
      const entry = pending.find((candidate) => candidate.request.customId === failure.customId)
      if (entry === undefined) continue
      entry.state.failed = true
      entry.state.warnings.push(
        warning('qa_failed', {
          lesson: entry.state.input.specId,
          gate: promptStage,
          error: failure.error,
        }),
      )
    }
  }

  const signal = input.signal === undefined ? {} : { signal: input.signal }

  /** (c) P6 over the current blocks of the given lessons. */
  const faithfulnessWave = async (candidates: readonly LessonState[], first: boolean) => {
    const pending: Pending<import('../schemas/qa').FaithfulnessOutput>[] = []
    for (const state of candidates) {
      state.claims = extractClaims(state.blocks)
      if (state.claims.length === 0) {
        state.gates.set('faithfulness', 'skipped')
        state.faithfulness = null
        continue
      }
      const cited = new Set(state.claims.flatMap((claim) => claim.citationIds))
      const fragments = state.citations
        .filter((citation) => cited.has(citation.id))
        .flatMap((citation) => {
          const text = chunkText.get(citation.chunk_id)
          return text === undefined ? [] : [{ citation, text }]
        })
      pending.push({
        state,
        request: buildFaithfulnessRequest(
          {
            parentCustomId: state.input.p3CustomId,
            lessonSpecId: state.input.specId,
            lang: input.lessonLanguage,
            claims: state.claims,
            fragments,
          },
          deps.prompts.faithfulness,
          signal,
        ),
      })
    }
    await dispatch(
      'qa_faithfulness',
      FAITHFULNESS_STAGE,
      deps.prompts.faithfulness,
      pending,
      first,
      (entry, value, model) => {
        const result = applyFaithfulness({
          lessonSpecId: entry.state.input.specId,
          blocks: entry.state.blocks,
          claims: entry.state.claims,
          output: value,
          mode: input.mode,
        })
        entry.state.blocks = [...result.blocks]
        entry.state.faithfulness = result.faithfulness
        entry.state.models.p6 = model
        absorb(entry.state, result)
        // The gate said so with `qa_failed`: nothing was verified, so nothing is reviewed.
        if (result.answered === 0) entry.state.failed = true
      },
    )
  }

  const live = (): LessonState[] => states.filter((state) => !state.failed)
  const wantsRegenerate = (state: LessonState): boolean =>
    state.gates.get('schema') === 'regenerate' ||
    (state.faithfulness !== null && state.faithfulness < FAITHFULNESS_REGENERATE) ||
    (state.pedagogy !== null && state.pedagogy < JUDGE_REGENERATE)

  await faithfulnessWave(live(), true)

  if (input.mode === 'full') {
    // (i) P7, on the judge role — never on the lesson's own author.
    let judgeTargets: readonly RoleTarget[] | null = null
    try {
      judgeTargets = resolveTargets('judge', await deps.registry())
    } catch (error) {
      deps.logger.warn(
        `[pathgen] the judge role is not configured; the pedagogy gate is skipped: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const judged: Pending<import('../schemas/qa').PedagogyJudgeOutput>[] = []
    for (const state of live()) {
      if (wantsRegenerate(state)) continue
      if (judgeTargets === null) {
        state.gates.set('judge', 'skipped')
        state.warnings.push(warning('judge_unavailable', { lesson: state.input.specId }))
        continue
      }
      if (judgeTargets[0]?.modelId === state.input.generatorModel) {
        state.gates.set('judge', 'skipped')
        state.warnings.push(
          warning('judge_same_as_generator', {
            lesson: state.input.specId,
            model: state.input.generatorModel,
          }),
        )
        continue
      }
      judged.push({
        state,
        request: buildJudgeRequest(
          {
            parentCustomId: state.input.p3CustomId,
            lessonSpecId: state.input.specId,
            lang: input.lessonLanguage,
            title: state.input.title,
            objectives: state.input.objectives,
            concepts: state.input.concepts.map((concept) => ({
              id: concept.id,
              name: concept.name,
            })),
            misconceptions: state.input.misconceptions,
            blocks: state.blocks,
          },
          deps.prompts.judge,
          signal,
        ),
      })
    }
    await dispatch(
      'qa_judge',
      PEDAGOGY_JUDGE_STAGE,
      deps.prompts.judge,
      judged,
      false,
      (entry, value, model) => {
        const result = applyJudge({
          lessonSpecId: entry.state.input.specId,
          output: value,
          answeredBy: model,
          generatorModel: entry.state.input.generatorModel,
          blockCount: entry.state.blocks.length,
        })
        entry.state.pedagogy = result.pedagogyScore
        entry.state.criteria = [...result.criteria]
        entry.state.models.p7 = result.outcome === 'skipped' ? null : model
        absorb(entry.state, result)
      },
    )

    // (j) P8, once, for the lessons some gate asked a fix of and none asked a rewrite of.
    const edited: Pending<import('../schemas/qa').EditLessonOutput>[] = []
    for (const state of live()) {
      if (wantsRegenerate(state)) continue
      const edits = [...state.edits.values()].flat()
      if (edits.length === 0) continue
      edited.push({
        state,
        request: buildEditRequest(
          {
            parentCustomId: state.input.p3CustomId,
            lessonSpecId: state.input.specId,
            lang: input.lessonLanguage,
            blocks: state.blocks,
            edits,
            glossary: state.input.theory.glossary,
          },
          deps.prompts.edit,
          signal,
        ),
      })
    }
    const reverify: LessonState[] = []
    await dispatch(
      'qa_edit',
      EDIT_LESSON_STAGE,
      deps.prompts.edit,
      edited,
      false,
      (entry, value, model) => {
        const edits = [...entry.state.edits.values()].flat()
        const result = applyEdits({
          lessonSpecId: entry.state.input.specId,
          blocks: entry.state.blocks,
          citations: entry.state.citations,
          edits,
          output: value,
        })
        entry.state.models.p8 = model
        entry.state.editIterations = 1
        entry.state.editApplied = result.applied > 0
        absorb(entry.state, result)
        if (result.applied === 0) return
        // The edited text is unverified until P6 answers for it: the pre-edit text is kept,
        // and the gate cleared, so a re-run that never comes leaves the lesson unreviewed
        // with the text P6 did vouch for — never an unverified rewrite marked `fixed`.
        entry.state.preEdit = {
          blocks: entry.state.blocks,
          citations: entry.state.citations,
          gates: new Map(entry.state.gates),
          findings: new Map(entry.state.findings),
          edits: new Map(entry.state.edits),
        }
        entry.state.blocks = [...result.blocks]
        entry.state.gates.delete('faithfulness')
        entry.state.faithfulness = null
        // The one self-critique iteration §5 gate 10 allows: the text gates and P6 again, and
        // nothing after that — a second P8 would be a second iteration.
        textGates(entry.state)
        reverify.push(entry.state)
      },
    )
    await faithfulnessWave(
      reverify.filter((state) => !state.failed),
      false,
    )
  }

  // --- verdicts -------------------------------------------------------------------------
  const outcomes: QaLessonOutcome[] = states.map((state) => {
    const lesson = state.input

    // P6 never answered for the text as it stands: the wave was never reached, or P8 changed
    // the text and the re-run did not come back. What P6 did vouch for is what goes out.
    const unverified = !state.gates.has('faithfulness')
    if (unverified && state.preEdit !== null) {
      state.blocks = state.preEdit.blocks
      state.citations = state.preEdit.citations
      for (const [gate, outcome] of state.preEdit.gates) state.gates.set(gate, outcome)
      for (const [gate, list] of state.preEdit.findings) state.findings.set(gate, list)
      for (const [gate, list] of state.preEdit.edits) state.edits.set(gate, list)
      state.gates.delete('faithfulness')
      state.gates.set('edit', 'skipped')
      state.editApplied = false
      state.preEdit = null
    }
    if (unverified && !state.failed) {
      state.warnings.push(
        warning('qa_failed', {
          lesson: lesson.specId,
          gate: FAITHFULNESS_STAGE,
          error: 'the run stopped before the verifier answered',
        }),
      )
    }

    const wanted = wantsRegenerate(state)
    const regenerate = wanted && input.allowRegenerate && lesson.attempt === 0 && !stopped()
    const band =
      input.mode === 'light' &&
      state.faithfulness !== null &&
      state.faithfulness >= FAITHFULNESS_REGENERATE &&
      state.faithfulness < FAITHFULNESS_PASS

    // Duplicate activities the block can spare go at the verdict, never before it.
    const duplicateActivities = state.duplicates.filter((pair) => pair.item.kind === 'activity')
    const spare = Math.max(0, state.activities.length - VARIETY_LIMITS.min)
    const duplicateActivityIds = duplicateActivities.slice(0, spare).map((pair) => pair.item.id)

    // A gate that asked for a fix nobody could apply — a concept never named, a block of
    // MCQs, a theory outside its band in light mode, a twin the block cannot spare — is not
    // a pass: the lesson goes out `flagged` so the badge says "Revisar" and the report says
    // why. The judge's own edits are advice over a score that already passed, and the edit
    // gate's `fix` *is* the fix.
    // §5 gate 4 (coverage) has no edit P8 can make — a missing concept mention can only be
    // fixed by rewriting the lesson — so a lesson that never covers one is `flagged` rather
    // than silently `pass`ing (the spec review's finding: "gate 4 has no consequence in the
    // verdict"). Gate 6 (variety) is excluded on purpose: it is documented report-only in
    // `gates/variety.ts` — P8 cannot add an activity family or a module's missing Bloom
    // level, only "Más ejemplos" or a regeneration can — so it stays a finding and a warning,
    // never a forced rewrite.
    const unresolved = [...state.gates].some(([gate, outcome]) => {
      if (outcome !== 'fix') return false
      if (gate === 'coverage') return true
      if (gate === 'edit' || gate === 'judge' || gate === 'variety') return false
      if (gate === 'duplicates') return state.duplicates.length > duplicateActivityIds.length
      return !(state.editApplied && (state.edits.get(gate)?.length ?? 0) > 0)
    })

    const verdict: QaVerdict =
      state.failed || unverified
        ? 'flagged'
        : wanted && !regenerate
          ? 'flagged'
          : band || unresolved
            ? 'flagged'
            : lesson.attempt > 0
              ? 'regenerated'
              : state.editApplied
                ? 'fixed'
                : 'pass'
    if (wanted && !regenerate && !state.failed && !unverified) {
      state.warnings.push(warning('lesson_below_threshold', { lesson: lesson.specId, final: 1 }))
    }

    const findings = QA_GATES.flatMap((gate) => state.findings.get(gate) ?? []).slice(
      0,
      MAX_FINDINGS,
    )
    const warnings = dedupeWarnings(state.warnings)
    runWarnings.push(...warnings)

    const qa: LessonQa = {
      faithfulness: state.faithfulness,
      pedagogy_score: state.pedagogy,
      coverage_ok: state.coverageOk,
      warnings,
      version: LESSON_QA_VERSION,
      run_id: input.runId,
      at: deps.clock.now().toISOString(),
      mode: input.mode,
      verdict,
      reviewed: !state.failed && !unverified,
      sources_count: new Set(state.citations.map((citation) => citation.source_id)).size,
      iterations: {
        edit: state.editIterations > 0 ? 1 : 0,
        regenerate: lesson.attempt > 0 ? 1 : 0,
      },
      gates: QA_GATES.map((gate) => ({ gate, outcome: state.gates.get(gate) ?? 'skipped' })),
      criteria: state.criteria,
      findings,
      cost: {
        usd: Math.round(state.usage.usd * 1e6) / 1e6,
        calls: state.calls,
        cache_hits: state.cacheHits,
      },
      models: { ...state.models },
    }

    return {
      lessonId: lesson.lessonId,
      specId: lesson.specId,
      qa,
      theory: { ...lesson.theory, blocks: state.blocks },
      citations: state.citations,
      regenerate,
      duplicateActivityIds,
    }
  })

  return {
    status,
    outcomes,
    usage: totals.usage,
    cacheHits: totals.cacheHits,
    calls: totals.calls,
    batchIds: [...new Set(totals.batchIds)],
    modelsUsed: [...totals.models].sort(),
    warnings: dedupeWarnings(runWarnings),
  }
}
