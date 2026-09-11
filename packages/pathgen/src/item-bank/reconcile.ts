import type { EmbeddingProvider, ItemBankRepository, PathRepository } from '@retenia/core'
import { checkDuplicates, type DuplicateItem } from '../qa/gates/duplicates'
import { type GenerationWarning, warning } from '../schemas/warnings'
import { activityStem, readAuthoring } from './stems'

/**
 * The other half of the bank's dedupe (§14 pitfall 3, the "Oboe failure"): the bank is built
 * at freeze, before most lessons exist, so every lesson that finishes expansion is checked
 * against it. The lesson wins — a bank item is regenerable, an exercise the learner already
 * practised is not — and a colliding item leaves the bank:
 *
 * - never shown (`exposure = 0`): soft-deleted with its activity;
 * - already shown in a diagnostic: kept for the diagnostic only, every other usage stripped,
 *   because a diagnostic in progress replays its answer log against these rows. An exposed
 *   item with no diagnostic usage is soft-deleted like an unexposed one.
 */

export interface ReconcileRepos {
  readonly paths: Pick<
    PathRepository,
    'listActivities' | 'findActivities' | 'findModule' | 'updateModule' | 'softDeleteActivity'
  >
  readonly itemBank: Pick<ItemBankRepository, 'listByPathVersion' | 'update' | 'softDelete'>
}

export interface ReconcileDeps {
  readonly repos: ReconcileRepos
  readonly embeddings?: Pick<EmbeddingProvider, 'embed'>
  /** Shared across calls of one run so each stem is embedded once. */
  readonly vectors?: Map<string, Float32Array | null>
}

export interface ReconcileInput {
  readonly pathVersionId: string
  readonly lessonId: string
  readonly lessonSpecId: string
}

export interface ReconcileResult {
  /** Bank ids soft-deleted. */
  readonly dropped: readonly string[]
  /** Bank ids kept for the diagnostic only. */
  readonly restricted: readonly string[]
  readonly warnings: readonly GenerationWarning[]
}

export async function reconcileItemBank(
  deps: ReconcileDeps,
  input: ReconcileInput,
): Promise<ReconcileResult> {
  const lessonActivities = await deps.repos.paths.listActivities(input.lessonId)
  const bank = (await deps.repos.itemBank.listByPathVersion(input.pathVersionId)).filter(
    (entry) => entry.usage.length > 0,
  )
  if (lessonActivities.length === 0 || bank.length === 0) {
    return { dropped: [], restricted: [], warnings: [] }
  }

  const activities = new Map(
    (await deps.repos.paths.findActivities(bank.map((entry) => entry.activityId))).map((a) => [
      a.id,
      a,
    ]),
  )
  const own: DuplicateItem[] = bank.map((entry) => {
    const activity = activities.get(entry.activityId)
    return {
      kind: 'activity',
      id: entry.id,
      lessonSpecId: 'bank',
      text: readAuthoring(entry).stem ?? (activity === undefined ? '' : activityStem(activity)),
    }
  })
  const others: DuplicateItem[] = lessonActivities.map((activity) => ({
    kind: 'activity',
    id: activity.id,
    lessonSpecId: input.lessonSpecId,
    text: activityStem(activity),
  }))

  const result = await checkDuplicates({
    lessonSpecId: 'bank',
    own,
    others,
    ...(deps.embeddings === undefined ? {} : { embeddings: deps.embeddings }),
    vectors: deps.vectors ?? new Map(),
  })

  const dropped: string[] = []
  const restricted: string[] = []
  const warnings: GenerationWarning[] = []
  const prunedModules = new Map<string, Set<string>>()
  const byId = new Map(bank.map((entry) => [entry.id, entry]))
  for (const pair of result.duplicates) {
    const entry = byId.get(pair.item.id)
    if (entry === undefined) continue
    if (entry.exposure > 0 && entry.usage.includes('diagnostic')) {
      if (entry.usage.length > 1) {
        await deps.repos.itemBank.update(entry.id, { usage: ['diagnostic'] })
        restricted.push(entry.id)
        warnings.push(
          warning('item_bank_reconciled', {
            lesson: input.lessonSpecId,
            item: entry.id,
            action: 'restricted',
          }),
        )
      }
      continue
    }
    await deps.repos.itemBank.softDelete(entry.id)
    await deps.repos.paths.softDeleteActivity(entry.activityId)
    dropped.push(entry.id)
    warnings.push(
      warning('item_bank_reconciled', {
        lesson: input.lessonSpecId,
        item: entry.id,
        action: 'dropped',
      }),
    )
    if (entry.moduleId !== null) {
      const set = prunedModules.get(entry.moduleId) ?? new Set<string>()
      set.add(entry.id)
      prunedModules.set(entry.moduleId, set)
    }
  }

  for (const [moduleId, ids] of prunedModules) {
    const module = await deps.repos.paths.findModule(moduleId)
    if (module === undefined) continue
    const kept = module.diagnosticItemIds.filter((id) => !ids.has(id))
    if (kept.length !== module.diagnosticItemIds.length) {
      await deps.repos.paths.updateModule(moduleId, { diagnosticItemIds: kept })
    }
  }

  return { dropped, restricted, warnings }
}
