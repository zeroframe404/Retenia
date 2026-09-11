import type { AiClient, AiResultCache, BatchRunner, Timers } from '@retenia/ai'
import type {
  AbortSignalLike,
  AuthoredItem,
  AuthoringConcept,
  AuthoringMisconception,
  ChunkRepository,
  Clock,
  EmbeddingProvider,
  ExamRepository,
  ItemAuthorRequest,
  ItemBankEntry,
  ItemBankRepository,
  ItemUsage,
  JsonObject,
  PathRepository,
} from '@retenia/core'
import { ITEM_USAGES } from '@retenia/core'
import { z } from 'zod'
import type { BudgetGuard } from '../budget'
import { difficultyLogitOf } from '../diagnostic/elo'
import { GenerationError } from '../errors'
import { expansionBinding } from '../expand/requests'
import { runWave, type WaveStatus } from '../expand/wave'
import type { PathgenLogger } from '../logger'
import type { PathgenPrompts } from '../prompts'
import { checkDuplicates, type DuplicateItem } from '../qa/gates/duplicates'
import { knowledgeGraphDocumentSchema } from '../schemas/knowledge-graph'
import { pathDraftSchema } from '../schemas/path-draft'
import { dedupeWarnings, type GenerationWarning, warning } from '../schemas/warnings'
import { addUsage, type StageUsage, ZERO_USAGE } from '../usage'
import {
  BLUEPRINT_VERSION,
  type Blueprint,
  type BlueprintCell,
  buildBlueprint,
  cellItemCount,
} from './blueprint'
import { coreLessonsSettled, coverageWeightedTopics, moduleCoverage } from './coverage'
import type { ItemAuthor, ItemAuthorCall } from './item-author'
import { activityStem, readAuthoring, usageFor } from './stems'

/**
 * Stage 9 — the item bank (`docs/spec/04-path-generation.md` §3 stage 9, §8, §9 P9).
 *
 * Built from the *frozen* version, right after "Confirmar ruta", so the diagnostic can start
 * while the lessons are still being written: the blueprint → one P9 call per cell (through
 * the same `runWave` as P1 and P4, so the budget, the Batch API and the result cache apply) →
 * the author's validation → **dedupe** against every lesson exercise that already exists and
 * every item already accepted (cosine > 0.92, `qa/gates/duplicates.ts`; §14 pitfall 3, "an
 * exam that repeats the quizzes") → one `activities` row (`lesson_id` NULL) and one
 * `item_bank` row per item. Lessons expanded later are reconciled against the bank
 * (`reconcile.ts`), so the order the two stages run in does not matter.
 *
 * Idempotent by cell: a cell with rows (`authoring.cell_key`) is never asked again, so a
 * build interrupted halfway resumes with the cells it had not reached.
 *
 * The exam cells wait for the lessons. Their weights are *importance × coverage*, and
 * coverage is only measurable once every core lesson has been written and through QA
 * (`coverage.ts`), so a build before that — the one at freeze, which the diagnostic waits on —
 * writes the diagnostic and reinforcement cells only. The first build after the lessons
 * settle measures coverage, keeps the resulting blueprint in the path's `final` exam row
 * (`exams.blueprint`, the shape 10.2's mock-exam editor reads) and builds the exam cells from
 * it; every later build reuses that stored blueprint, so a lesson regenerated afterwards can
 * never reshuffle cells the bank already paid for.
 */

/** `exams.scope` of the final exam whose blueprint the bank measured. */
export const EXAM_SCOPE_KEY = 'path_version_id'

const storedTopicsSchema = z.array(
  z.object({ module_id: z.string().min(1), weight: z.number().min(0) }),
)

export const ITEM_BANK_STAGE = 'P9_items'
/** P9 asks for `overGeneration ×` each cell's count; the pool is filtered to it. */
export const ITEM_BANK_OVER_GENERATION = 2
export const DEFAULT_ITEM_BANK_CONCURRENCY = 4
/** Source fragments per cell: the prompt clamps each; eight is plenty for three or four items. */
export const MAX_CELL_EXCERPTS = 8

export interface ItemBankTxRepos {
  readonly paths: Pick<PathRepository, 'createActivity'>
  readonly itemBank: Pick<ItemBankRepository, 'create'>
}

export interface ItemBankRepos {
  readonly paths: Pick<
    PathRepository,
    'findVersion' | 'loadTree' | 'findActivities' | 'updateModule'
  >
  readonly itemBank: Pick<ItemBankRepository, 'listByPathVersion'>
  readonly chunks: Pick<ChunkRepository, 'findMany'>
  /** Where the measured exam blueprint is kept. Absent: coverage is re-measured every build. */
  readonly exams?: Pick<ExamRepository, 'listByPath' | 'create'>
  transaction<T>(work: (repos: ItemBankTxRepos) => Promise<T>): Promise<T>
}

export interface ItemBankProgress {
  readonly pathVersionId: string
  readonly done: number
  readonly total: number
}

export interface ItemBankDeps {
  readonly ai: Pick<AiClient, 'structured'>
  readonly runner?: Pick<BatchRunner, 'runJob' | 'poll' | 'list' | 'cancel'>
  readonly resultCache?: Pick<AiResultCache, 'get'>
  readonly author: ItemAuthor
  readonly repos: ItemBankRepos
  readonly prompts: Pick<PathgenPrompts, 'items'>
  /** Absent means dedupe on the exact normalised stem only. */
  readonly embeddings?: Pick<EmbeddingProvider, 'embed'>
  readonly clock: Clock
  readonly timers: Pick<Timers, 'sleep'>
  readonly logger: PathgenLogger
  readonly concurrency?: number
  readonly onProgress?: (progress: ItemBankProgress) => void
  readonly onBatch?: (batchId: string) => void | Promise<void>
}

export interface BuildItemBankInput {
  readonly pathVersionId: string
  readonly allowOverBudget: boolean
  /** The diagnostic is waiting on it: synchronous calls, not the Batch API. Default true. */
  readonly userWaiting?: boolean
  readonly budget?: BudgetGuard
  readonly perCallEstimateUsd?: number
  readonly signal?: AbortSignalLike
}

export interface BuildItemBankResult {
  readonly pathVersionId: string
  readonly blueprint: Blueprint
  readonly status: WaveStatus
  /** A core lesson has not settled yet, so the exam cells were left for a later build. */
  readonly examDeferred: boolean
  /** Counts the cells this build planned — the exam's excluded while it is deferred. */
  readonly cells: {
    readonly total: number
    readonly alreadyBuilt: number
    readonly built: number
    readonly short: number
    readonly failed: number
  }
  readonly created: number
  readonly byUsage: Readonly<Record<ItemUsage, number>>
  readonly warnings: readonly GenerationWarning[]
  readonly usage: StageUsage
}

/** One item a cell wants: a difficulty, on a form when the cell has forms. */
interface Slot {
  readonly difficulty: number
  readonly form: 'A' | 'B' | null
}

/** A promise chain: answers arrive concurrently, but acceptance reads what was accepted. */
function serial(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return (work) => {
    const next = tail.then(work, work)
    tail = next.catch(() => undefined)
    return next
  }
}

function emptyUsageCounts(): Record<ItemUsage, number> {
  return Object.fromEntries(ITEM_USAGES.map((usage) => [usage, 0])) as Record<ItemUsage, number>
}

export async function buildItemBank(
  deps: ItemBankDeps,
  input: BuildItemBankInput,
): Promise<BuildItemBankResult> {
  const version = await deps.repos.paths.findVersion(input.pathVersionId)
  if (version === undefined) {
    throw new GenerationError('version_not_found', `no path version "${input.pathVersionId}"`)
  }
  if (version.frozenAt === null) {
    throw new GenerationError(
      'version_not_found',
      `path version "${input.pathVersionId}" is not frozen; the item bank reads a frozen path`,
    )
  }
  const tree = await deps.repos.paths.loadTree(version.id)
  if (tree === undefined) {
    throw new GenerationError('version_not_found', `path version "${version.id}" has no tree`)
  }
  const draft = pathDraftSchema.parse(version.spec)
  const graph = knowledgeGraphDocumentSchema.parse(version.knowledgeGraph ?? {})
  const nodes = new Map(graph.nodes.map((node) => [node.concept_id, node]))

  const draftModules = draft.sections.flatMap((section) => section.modules)
  const dbModuleOf = new Map(
    tree.sections.flatMap((section) => section.modules.map((module) => [module.specId, module])),
  )

  const blueprintModules = draftModules.map((module) => ({
    id: module.id,
    objectiveBlooms: module.objectives.map((objective) => objective.bloom),
    conceptBlooms: module.concept_ids.flatMap((id) => {
      const node = nodes.get(id)
      return node === undefined ? [] : [node.bloom_target]
    }),
  }))

  // The exam's weights: stored once measured; measured once the lessons have settled; the
  // draft's until then (only the exam cells read them, and those wait).
  const examReady = coreLessonsSettled(tree)
  const stored = examReady ? await storedExamBlueprint(deps.repos.exams, version) : NOTHING_STORED
  let topics: readonly { readonly module_id: string; readonly weight: number }[] =
    draft.final_exam.blueprint.topics
  let examItemCount = draft.final_exam.blueprint.item_count
  let coverage: ReadonlyMap<string, number> | null = null
  if (stored.topics !== null) {
    topics = stored.topics
    examItemCount = stored.examItemCount ?? examItemCount
  } else if (examReady) {
    coverage = moduleCoverage(tree, draftModules, (id) => nodes.get(id)?.importance ?? 0)
    topics = coverageWeightedTopics(draft.final_exam.blueprint.topics, coverage)
  }
  if (stored.exists && stored.topics === null) {
    // Someone else's shape — say a blueprint 10.2's editor imported from a syllabus. It is
    // theirs to keep: the bank weighs by what it measured and leaves the row alone.
    deps.logger.warn(
      `[item-bank] the final exam of ${version.id} keeps a blueprint the bank cannot read; ` +
        'weighting its items by the measured coverage instead',
    )
  }

  const blueprint = buildBlueprint({ modules: blueprintModules, topics, examItemCount })

  if (examReady && !stored.exists && deps.repos.exams !== undefined) {
    await deps.repos.exams.create({
      title: draft.title,
      kind: 'final',
      date: null,
      pathId: version.pathId,
      scope: {
        [EXAM_SCOPE_KEY]: version.id,
        blueprint_version: BLUEPRINT_VERSION,
        exam_item_count: blueprint.exam_item_count,
      },
      blueprint: blueprint.topics.map((topic) => ({
        topic: topic.module_id,
        module_id: topic.module_id,
        weight: topic.weight,
        coverage: coverage?.get(topic.module_id) ?? 1,
        bloom_mix: { ...topic.bloom_mix },
        difficulty_mix: { ...topic.difficulty_mix },
        exam_items: topic.exam_items,
      })),
      targetRetention: 0.95,
      finalWindowDays: 3,
      studyDaysMask: 127,
      dailyCapacityMinutes: null,
      status: 'planned',
    })
  }

  // What exists: the bank's cells, and every question a learner will already have seen.
  const existing = await deps.repos.itemBank.listByPathVersion(version.id)
  const builtCells = new Set(
    existing.flatMap((entry) => {
      const key = readAuthoring(entry).cellKey
      return key === null ? [] : [key]
    }),
  )
  const lessonQuestions: DuplicateItem[] = tree.sections.flatMap((section) =>
    section.modules.flatMap((module) =>
      module.lessons.flatMap((lesson) =>
        lesson.activities.map((activity) => ({
          kind: 'activity' as const,
          id: activity.id,
          lessonSpecId: lesson.specId,
          text: activityStem(activity),
        })),
      ),
    ),
  )
  const existingActivities = await deps.repos.paths.findActivities(
    existing.map((entry) => entry.activityId),
  )
  const accepted: DuplicateItem[] = existingActivities.map((activity) => ({
    kind: 'activity',
    id: activity.id,
    lessonSpecId: 'bank',
    text: activityStem(activity),
  }))

  const planCells = examReady
    ? blueprint.cells
    : blueprint.cells.filter((cell) => cell.kind !== 'exam')
  const pending = planCells.filter(
    (cell) => !builtCells.has(cell.key) && dbModuleOf.has(cell.moduleId),
  )
  const warnings: GenerationWarning[] = []

  const requestFor = async (cell: BlueprintCell): Promise<ItemAuthorRequest> => {
    const module = draftModules.find((m) => m.id === cell.moduleId)
    const conceptIds = module?.concept_ids ?? []
    const concepts: AuthoringConcept[] = conceptIds.flatMap((id) => {
      const node = nodes.get(id)
      return node === undefined ? [] : [{ id, name: node.canonical, definition: node.definition }]
    })
    const known = new Set(conceptIds)
    const misconceptions: AuthoringMisconception[] = draft.misconceptions
      .filter((misconception) => known.has(misconception.concept_id))
      .map((misconception) => ({
        id: misconception.id,
        conceptId: misconception.concept_id,
        text: misconception.text,
        whyWrong: misconception.why_wrong,
      }))
    const refs = conceptIds
      .flatMap((id) => nodes.get(id)?.source_refs ?? [])
      .sort((a, b) => a.ordinal - b.ordinal)
    const chunkIds = [...new Set(refs.map((ref) => ref.chunk_id))].slice(0, MAX_CELL_EXCERPTS)
    const chunks = chunkIds.length === 0 ? [] : await deps.repos.chunks.findMany(chunkIds)
    const lessonSpecIds = new Set(module?.lessons.map((lesson) => lesson.id) ?? [])
    return {
      blueprintKey: `${version.id}:${blueprint.version}`,
      lang: draft.language,
      moduleTitle: module?.title ?? cell.moduleId,
      objectives: (module?.objectives ?? []).map((objective) => ({
        text: objective.text,
        bloom: objective.bloom,
      })),
      concepts,
      misconceptions,
      excerpts: chunks.map((chunk) => chunk.text),
      cell,
      overGeneration: ITEM_BANK_OVER_GENERATION,
      avoid: [
        ...lessonQuestions.filter((q) => lessonSpecIds.has(q.lessonSpecId)).map((q) => q.text),
        ...accepted.map((q) => q.text),
      ],
    }
  }

  const planned: { cell: BlueprintCell; call: ItemAuthorCall }[] = []
  for (const cell of pending) {
    const call = deps.author.plan(
      await requestFor(cell),
      input.signal === undefined ? {} : { signal: input.signal },
    )
    if (call.injectionSuspected) {
      warnings.push(warning('item_bank_injection_suspected', { cell: cell.key }))
    }
    planned.push({ cell, call })
  }

  const vectors = new Map<string, Float32Array | null>()
  const isDuplicate = async (item: AuthoredItem, cellKey: string): Promise<boolean> => {
    const others = [...lessonQuestions, ...accepted]
    const result = await checkDuplicates({
      lessonSpecId: cellKey,
      own: [{ kind: 'activity', id: item.key, lessonSpecId: cellKey, text: item.stem }],
      others,
      ...(deps.embeddings === undefined ? {} : { embeddings: deps.embeddings }),
      vectors,
    })
    if (result.warnings.some((entry) => entry.code === 'embeddings_unavailable')) {
      warnings.push(warning('embeddings_unavailable', { stage: 'item_bank' }))
    }
    const pair = result.duplicates[0]
    if (pair === undefined) return false
    warnings.push(warning('item_duplicate', { cell: cellKey, reason: pair.reason }))
    return true
  }

  const byUsage = emptyUsageCounts()
  let created = 0
  let built = 0
  let short = 0
  let done = 0
  const exclusive = serial()

  /**
   * The concepts each module's diagnostic items already cover, by DB module id. §10 step 5
   * never asks a concept twice, so a diagnostic item on a concept its module's other items
   * already test is a question the engine can never serve — and a module left with a single
   * servable item can only reach "known" through the apply shortcut.
   */
  const diagnosticConcepts = new Map<string, Set<string>>()
  for (const entry of existing) {
    if (entry.moduleId === null || !entry.usage.includes('diagnostic')) continue
    const covered = diagnosticConcepts.get(entry.moduleId) ?? new Set<string>()
    for (const id of readAuthoring(entry).conceptIds) covered.add(id)
    diagnosticConcepts.set(entry.moduleId, covered)
  }

  const accept = async (cell: BlueprintCell, pool: readonly AuthoredItem[]): Promise<void> => {
    const module = dbModuleOf.get(cell.moduleId)
    if (module === undefined) return
    const used = new Set<string>()
    const covered = diagnosticConcepts.get(module.id) ?? new Set<string>()
    diagnosticConcepts.set(module.id, covered)
    /** 1 when a diagnostic candidate repeats a concept its module already covers. */
    const repeats = (item: AuthoredItem): number =>
      cell.kind === 'diagnostic' && item.conceptIds.some((id) => covered.has(id)) ? 1 : 0
    const chosen: AuthoredItem[] = []
    const slots = cell.difficulties.flatMap((difficulty): readonly Slot[] =>
      cell.forms.length === 0
        ? [{ difficulty, form: null }]
        : cell.forms.map((form) => ({ difficulty, form })),
    )
    for (const slot of slots) {
      const candidates = pool
        .filter((item) => !used.has(item.key) && item.form === slot.form)
        .sort(
          (a, b) =>
            repeats(a) - repeats(b) ||
            Math.abs(a.difficulty - slot.difficulty) - Math.abs(b.difficulty - slot.difficulty),
        )
      for (const candidate of candidates) {
        used.add(candidate.key)
        if (await isDuplicate(candidate, cell.key)) continue
        chosen.push(candidate)
        if (cell.kind === 'diagnostic') {
          for (const id of candidate.conceptIds) covered.add(id)
        }
        accepted.push({
          kind: 'activity',
          id: candidate.key,
          lessonSpecId: 'bank',
          text: candidate.stem,
        })
        break
      }
    }
    if (chosen.length < cellItemCount(cell)) {
      short += 1
      warnings.push(
        warning('item_bank_cell_short', {
          cell: cell.key,
          wanted: cellItemCount(cell),
          kept: chosen.length,
        }),
      )
    }
    if (chosen.length === 0) return
    await deps.repos.transaction(async (tx) => {
      for (const item of chosen) {
        const activity = await tx.paths.createActivity({
          ...item.row,
          lessonId: null,
          ordinal: null,
        })
        const usage = usageFor(cell.kind, item.form)
        await tx.itemBank.create({
          activityId: activity.id,
          pathVersionId: version.id,
          moduleId: module.id,
          usage,
          difficultyLogit: difficultyLogitOf(item.difficulty),
          discriminationHint: null,
          exposure: 0,
          stats: { n: 0, p_correct: null },
          authoring: {
            cell_key: cell.key,
            kind: cell.kind,
            form: item.form,
            difficulty: item.difficulty,
            stem: item.stem,
            concept_ids: [...item.conceptIds],
            misconception_by_option: { ...item.misconceptionByOption },
          } satisfies JsonObject,
        })
        for (const tag of usage) byUsage[tag] += 1
        created += 1
      }
    })
    built += 1
  }

  let status: WaveStatus = 'completed'
  let usage: StageUsage = ZERO_USAGE
  let failed = 0
  if (planned.length > 0) {
    deps.onProgress?.({ pathVersionId: version.id, done: 0, total: planned.length })
    const result = await runWave<unknown>(
      {
        ai: deps.ai,
        ...(deps.runner === undefined ? {} : { runner: deps.runner }),
        ...(deps.resultCache === undefined ? {} : { resultCache: deps.resultCache }),
        clock: deps.clock,
        timers: deps.timers,
        logger: deps.logger,
        concurrency: deps.concurrency ?? DEFAULT_ITEM_BANK_CONCURRENCY,
        ...(deps.onBatch === undefined ? {} : { onBatch: deps.onBatch }),
      },
      {
        requests: planned.map(({ call }) => call),
        binding: expansionBinding(deps.prompts.items, ITEM_BANK_STAGE, {
          allowOverBudget: input.allowOverBudget,
        }),
        userWaiting: input.userWaiting ?? true,
        allowOverBudget: input.allowOverBudget,
        ...(input.budget === undefined ? {} : { budget: input.budget }),
        ...(input.perCallEstimateUsd === undefined
          ? {}
          : { perCallEstimateUsd: input.perCallEstimateUsd }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
      ({ index, value }) =>
        exclusive(async () => {
          const { cell, call } = planned[index] as (typeof planned)[number]
          const collected = deps.author.collect(call, value)
          for (const rejection of collected.rejected) {
            warnings.push(
              warning('item_rejected', {
                cell: cell.key,
                type: rejection.type,
                code: rejection.code,
              }),
            )
          }
          await accept(cell, collected.items)
          done += 1
          deps.onProgress?.({ pathVersionId: version.id, done, total: planned.length })
        }),
    )
    status = result.status
    usage = addUsage(usage, result.usage)
    for (const failure of result.failed) {
      const cell = planned.find(({ call }) => call.customId === failure.customId)?.cell
      failed += 1
      warnings.push(
        warning('item_bank_cell_failed', {
          cell: cell?.key ?? failure.customId,
          error: failure.error,
        }),
      )
    }
  }

  // Every diagnostic item of each module, the old and the new, on the module row (§8's
  // `diagnostic_items[]`), so the path map and the diagnostic read one list.
  const all = await deps.repos.itemBank.listByPathVersion(version.id)
  const byModule = new Map<string, string[]>()
  for (const entry of all as readonly ItemBankEntry[]) {
    if (entry.moduleId === null || !entry.usage.includes('diagnostic')) continue
    const list = byModule.get(entry.moduleId) ?? []
    list.push(entry.id)
    byModule.set(entry.moduleId, list)
  }
  for (const module of dbModuleOf.values()) {
    const ids = byModule.get(module.id) ?? []
    const current = module.diagnosticItemIds
    if (ids.length === current.length && ids.every((id, i) => id === current[i])) continue
    await deps.repos.paths.updateModule(module.id, { diagnosticItemIds: ids })
  }

  return {
    pathVersionId: version.id,
    blueprint,
    status,
    examDeferred: !examReady,
    cells: {
      total: planCells.length,
      alreadyBuilt: planCells.length - pending.length,
      built,
      short,
      failed,
    },
    created,
    byUsage,
    warnings: dedupeWarnings(warnings),
    usage,
  }
}

interface StoredExamBlueprint {
  /** The version has a `final` exam row — whether or not the bank can read its blueprint. */
  readonly exists: boolean
  /** Its topics, when they are the bank's own `{ module_id, weight }` shape. */
  readonly topics: { module_id: string; weight: number }[] | null
  readonly examItemCount: number | null
}

const NOTHING_STORED: StoredExamBlueprint = { exists: false, topics: null, examItemCount: null }

/**
 * The version's `final` exam row, and the blueprint a previous build measured into it. A row
 * whose blueprint does not parse still `exists`: the build must neither add a second row
 * beside it nor overwrite what someone else put there.
 */
async function storedExamBlueprint(
  exams: ItemBankRepos['exams'],
  version: { readonly id: string; readonly pathId: string },
): Promise<StoredExamBlueprint> {
  if (exams === undefined) return NOTHING_STORED
  const rows = await exams.listByPath(version.pathId)
  const row = rows.find(
    (exam) =>
      exam.kind === 'final' && exam.deletedAt === null && exam.scope[EXAM_SCOPE_KEY] === version.id,
  )
  if (row === undefined) return NOTHING_STORED
  const topics = storedTopicsSchema.safeParse(row.blueprint)
  const count = row.scope.exam_item_count
  return {
    exists: true,
    topics: topics.success && topics.data.length > 0 ? topics.data : null,
    examItemCount:
      typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null,
  }
}

export interface ExamCellsDueRepos {
  readonly paths: Pick<PathRepository, 'findVersion' | 'loadTree'>
  readonly itemBank: Pick<ItemBankRepository, 'listByPathVersion'>
}

/**
 * Whether a build would now write exam cells the bank does not have: the version is frozen,
 * every core lesson has settled, and no exam item exists yet. What main asks each time a
 * lesson settles, so the exam is built once, right after the last lesson — and not re-asked
 * on every later lesson event.
 */
export async function examCellsDue(
  repos: ExamCellsDueRepos,
  pathVersionId: string,
): Promise<boolean> {
  const version = await repos.paths.findVersion(pathVersionId)
  if (version === undefined || version.frozenAt === null) return false
  const tree = await repos.paths.loadTree(version.id)
  if (tree === undefined || !coreLessonsSettled(tree)) return false
  const entries = await repos.itemBank.listByPathVersion(version.id)
  return !entries.some((entry) => entry.authoring.kind === 'exam')
}
