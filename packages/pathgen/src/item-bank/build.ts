import type { AiClient, AiResultCache, BatchRunner, Timers } from '@retenia/ai'
import type {
  AbortSignalLike,
  AuthoredItem,
  AuthoringConcept,
  AuthoringMisconception,
  ChunkRepository,
  Clock,
  EmbeddingProvider,
  ItemAuthorRequest,
  ItemBankEntry,
  ItemBankRepository,
  ItemUsage,
  JsonObject,
  PathRepository,
} from '@retenia/core'
import { ITEM_USAGES } from '@retenia/core'
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
import { type Blueprint, type BlueprintCell, buildBlueprint, cellItemCount } from './blueprint'
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
 */

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

  const blueprint = buildBlueprint({
    modules: draftModules.map((module) => ({
      id: module.id,
      objectiveBlooms: module.objectives.map((objective) => objective.bloom),
      conceptBlooms: module.concept_ids.flatMap((id) => {
        const node = nodes.get(id)
        return node === undefined ? [] : [node.bloom_target]
      }),
    })),
    topics: draft.final_exam.blueprint.topics,
    examItemCount: draft.final_exam.blueprint.item_count,
  })

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

  const pending = blueprint.cells.filter(
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
    cells: {
      total: blueprint.cells.length,
      alreadyBuilt: blueprint.cells.length - pending.length,
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
