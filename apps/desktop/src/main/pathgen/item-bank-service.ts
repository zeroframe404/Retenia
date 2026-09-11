import type { ItemBankEntry, ItemBankRepository, ItemUsage } from '@retenia/core'
import type { ItemBankStatusDto } from '@retenia/ipc-contract'
import type {
  BuildItemBankInput,
  BuildItemBankResult,
  ReconcileInput,
  ReconcileResult,
} from '@retenia/pathgen'
import { readAuthoring } from '@retenia/pathgen'
import { log } from '../logging/log'

/**
 * Stage 9 in the main process (sub-phase 8.5): starts the item-bank build of a frozen version
 * in the background, remembers how the last one went, and answers `pathgen.getItemBank` from
 * the rows themselves — so the status after a restart is still true, only less detailed.
 *
 * One build per version at a time: a second request while one runs joins it rather than
 * paying for the same cells twice (the build is idempotent by cell anyway; this saves the
 * wave's bookkeeping, not correctness).
 */

export interface ItemBankService {
  /** Starts (or joins) the build and returns at once with the current status. */
  build(
    pathVersionId: string,
    options?: { readonly allowOverBudget?: boolean },
  ): Promise<ItemBankStatusDto>
  /** The same build, awaited — what the E2E suite and the tests want. */
  buildAndWait(
    pathVersionId: string,
    options?: { readonly allowOverBudget?: boolean },
  ): Promise<ItemBankStatusDto>
  status(pathVersionId: string): Promise<ItemBankStatusDto>
  /** Run after a lesson finished expansion: the lesson wins over any bank item it repeats. */
  reconcileLesson(input: ReconcileInput): Promise<void>
}

export interface ItemBankServiceDeps {
  readonly repos: { readonly itemBank: Pick<ItemBankRepository, 'listByPathVersion'> }
  readonly build: (input: BuildItemBankInput) => Promise<BuildItemBankResult>
  readonly reconcile: (input: ReconcileInput) => Promise<ReconcileResult>
}

interface BuildRecord {
  running: Promise<void> | null
  last: BuildItemBankResult | null
  error: string | null
}

const USAGES: readonly ItemUsage[] = [
  'diagnostic',
  'reinforcement',
  'final_exam_A',
  'final_exam_B',
  'remediation',
  'mock',
]

export function createItemBankService(deps: ItemBankServiceDeps): ItemBankService {
  const records = new Map<string, BuildRecord>()
  const recordOf = (id: string): BuildRecord => {
    let record = records.get(id)
    if (record === undefined) {
      record = { running: null, last: null, error: null }
      records.set(id, record)
    }
    return record
  }

  const status = async (pathVersionId: string): Promise<ItemBankStatusDto> => {
    const entries: ItemBankEntry[] = await deps.repos.itemBank.listByPathVersion(pathVersionId)
    const record = records.get(pathVersionId)
    const byUsage = Object.fromEntries(USAGES.map((usage) => [usage, 0])) as Record<
      ItemUsage,
      number
    >
    for (const entry of entries) for (const usage of entry.usage) byUsage[usage] += 1
    const builtCells = new Set(
      entries.flatMap((entry) => {
        const key = readAuthoring(entry).cellKey
        return key === null ? [] : [key]
      }),
    )
    const last = record?.last ?? null
    const state: ItemBankStatusDto['state'] =
      record?.running != null
        ? 'building'
        : record?.error != null
          ? 'failed'
          : entries.length === 0
            ? // A build that ran to the end and wrote nothing is a failure, not an empty bank —
              // "empty" is what makes the diagnostic screen start another build.
              last !== null
              ? 'failed'
              : 'empty'
            : last !== null && (last.cells.short > 0 || last.cells.failed > 0)
              ? 'partial'
              : 'ready'
    return {
      pathVersionId,
      state,
      items: entries.length,
      diagnosticItems: byUsage.diagnostic,
      byUsage,
      cells:
        last === null
          ? { total: builtCells.size, built: builtCells.size, short: 0, failed: 0 }
          : {
              total: last.cells.total,
              built: last.cells.alreadyBuilt + last.cells.built,
              short: last.cells.short,
              failed: last.cells.failed,
            },
      warnings: last === null ? [] : last.warnings.map((warning) => ({ ...warning })),
      error:
        record?.error ??
        (last !== null && entries.length === 0 ? 'the build produced no items' : null),
    }
  }

  const start = (pathVersionId: string, allowOverBudget: boolean): Promise<void> => {
    const record = recordOf(pathVersionId)
    if (record.running !== null) return record.running
    record.error = null
    record.running = deps
      .build({ pathVersionId, allowOverBudget, userWaiting: true })
      .then((result) => {
        record.last = result
        log.info(
          `[pathgen] item bank of ${pathVersionId}: ${result.created} item(s) created, ` +
            `${result.cells.short} short and ${result.cells.failed} failed cell(s)`,
        )
      })
      .catch((error: unknown) => {
        // Clamped: the status DTO caps `error` at 2,000 characters, and a zod issue list can be
        // longer — a status that fails its own schema would lock the diagnostic screen out.
        const message = error instanceof Error ? error.message : String(error)
        record.error = message.length > 500 ? `${message.slice(0, 500)}…` : message
        log.warn(`[pathgen] the item bank of ${pathVersionId} could not be built:`, error)
      })
      .finally(() => {
        record.running = null
      })
    return record.running
  }

  return {
    build: async (pathVersionId, options = {}) => {
      void start(pathVersionId, options.allowOverBudget === true)
      return status(pathVersionId)
    },

    buildAndWait: async (pathVersionId, options = {}) => {
      await start(pathVersionId, options.allowOverBudget === true)
      return status(pathVersionId)
    },

    status,

    reconcileLesson: async (input) => {
      try {
        const result = await deps.reconcile(input)
        if (result.dropped.length + result.restricted.length > 0) {
          log.info(
            `[pathgen] lesson ${input.lessonSpecId} displaced ${result.dropped.length} bank ` +
              `item(s) and restricted ${result.restricted.length} to the diagnostic`,
          )
        }
      } catch (error) {
        log.warn(`[pathgen] reconciling lesson ${input.lessonSpecId} with the bank failed:`, error)
      }
    },
  }
}
