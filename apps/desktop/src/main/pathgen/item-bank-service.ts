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
  /**
   * Run whenever a lesson settles (ready or failed): once the last core lesson of the version
   * has, the exam cells — which wait for coverage to be measurable — are built in the
   * background. Never throws.
   */
  onLessonSettled(pathVersionId: string): Promise<void>
}

export interface ItemBankServiceDeps {
  readonly repos: { readonly itemBank: Pick<ItemBankRepository, 'listByPathVersion'> }
  readonly build: (input: BuildItemBankInput) => Promise<BuildItemBankResult>
  readonly reconcile: (input: ReconcileInput) => Promise<ReconcileResult>
  /** `examCellsDue` over the repositories. Absent: a settled lesson triggers nothing. */
  readonly examDue?: (pathVersionId: string) => Promise<boolean>
}

interface BuildOptions {
  readonly allowOverBudget: boolean
  /**
   * Somebody is waiting on it — the diagnostic screen: synchronous calls, and its progress and
   * failure are the bank's status. A build nobody waits for (the exam's, after the lessons)
   * goes through the Batch API when there is one, and never changes what that screen shows:
   * the diagnostic's questions do not depend on it.
   */
  readonly userWaiting: boolean
}

interface BuildRecord {
  running: Promise<void> | null
  runningOptions: BuildOptions | null
  last: BuildItemBankResult | null
  error: string | null
  /** What requests that arrived during the running build still need once it ends. */
  again: BuildOptions | null
}

function merged(current: BuildOptions | null, next: BuildOptions): BuildOptions {
  return current === null
    ? next
    : {
        allowOverBudget: current.allowOverBudget || next.allowOverBudget,
        userWaiting: current.userWaiting || next.userWaiting,
      }
}

const BACKGROUND: BuildOptions = { allowOverBudget: false, userWaiting: false }

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
      record = { running: null, runningOptions: null, last: null, error: null, again: null }
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
      record?.running != null && record.runningOptions?.userWaiting === true
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

  const start = (pathVersionId: string, options: BuildOptions): Promise<void> => {
    const record = recordOf(pathVersionId)
    if (record.running !== null) {
      // Joining is enough unless this asks for more than the build in flight was given — the
      // over-budget pass it lacks, or a learner now waiting behind a background build — and
      // then a second build follows with what was asked.
      const current = record.runningOptions
      if (
        current !== null &&
        ((options.allowOverBudget && !current.allowOverBudget) ||
          (options.userWaiting && !current.userWaiting))
      ) {
        record.again = merged(record.again, options)
      }
      return record.running
    }
    if (options.userWaiting) record.error = null
    record.runningOptions = options
    record.running = deps
      .build({
        pathVersionId,
        allowOverBudget: options.allowOverBudget,
        userWaiting: options.userWaiting,
      })
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
        if (options.userWaiting) {
          record.error = message.length > 500 ? `${message.slice(0, 500)}…` : message
        }
        log.warn(`[pathgen] the item bank of ${pathVersionId} could not be built:`, error)
      })
      .finally(() => {
        record.running = null
        record.runningOptions = null
        // A request the ended build could not serve — it started before the last lesson
        // settled, or without the over-budget pass since asked for — gets its own build now.
        const next = record.again
        if (next !== null) {
          record.again = null
          void start(pathVersionId, next)
        }
      })
    return record.running
  }

  const waited = (options: { readonly allowOverBudget?: boolean }): BuildOptions => ({
    allowOverBudget: options.allowOverBudget === true,
    userWaiting: true,
  })

  return {
    build: async (pathVersionId, options = {}) => {
      void start(pathVersionId, waited(options))
      return status(pathVersionId)
    },

    buildAndWait: async (pathVersionId, options = {}) => {
      await start(pathVersionId, waited(options))
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

    onLessonSettled: async (pathVersionId) => {
      if (deps.examDue === undefined) return
      try {
        if (!(await deps.examDue(pathVersionId))) return
        const record = recordOf(pathVersionId)
        if (record.running !== null) {
          record.again = merged(record.again, BACKGROUND)
          return
        }
        log.info(`[pathgen] every lesson of ${pathVersionId} settled: building the exam items`)
        void start(pathVersionId, BACKGROUND)
      } catch (error) {
        log.warn(`[pathgen] checking whether ${pathVersionId} needs its exam items failed:`, error)
      }
    },
  }
}
