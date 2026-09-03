import type {
  DayBoundary,
  ExamOverrideSource,
  ImportanceCatalog,
  ImportanceLevel,
  ImportanceMix,
  ImportanceMixQuery,
  ImportanceResolution,
  RescheduleImpact,
  RescheduleNow,
  RescheduleSelection,
  Scheduler,
  SchedulingPolicyInput,
  SimulateReschedule,
  UnitOfWork,
  UrgentModeHours,
  UrgentModeResult,
} from '@retenia/core'
import {
  createExamOverrides,
  createExpireUrgentMode,
  createFsrsScheduler,
  createImportanceCatalog,
  createImportanceMix,
  createImportanceResolver,
  createRescheduleNow,
  createSimulateReschedule,
  createStartUrgentMode,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_TIME_ZONE,
} from '@retenia/core'
import { log } from '../logging/log'

/**
 * The memory system's main-process service: everything the `items.*`, `cards.*` and
 * `memory.*` channels call (`docs/spec/02-memory-system.md` §7).
 *
 * It owns the `ImportanceCatalog` — the five `importance_levels` rows, read once at startup
 * rather than once per card — the shared `FsrsScheduler`, and the use cases built over
 * them. `handlers.ts` stays a thin adapter that maps `Date` to ISO and back.
 */

export interface MemoryService {
  setItemImportance(ids: readonly string[], level: ImportanceLevel): Promise<number>
  overrideCardImportance(
    ids: readonly string[],
    level: ImportanceLevel | null,
    expiresAt: Date | null,
  ): Promise<number>
  importanceMix(): Promise<ImportanceMix>
  simulateReschedule(selection: RescheduleSelection): Promise<RescheduleImpact>
  rescheduleNow(
    selection: RescheduleSelection,
  ): Promise<{ impact: RescheduleImpact; applied: number }>
  startUrgentMode(itemIds: readonly string[], hours?: UrgentModeHours): Promise<UrgentModeResult>
  /** Clears every lapsed urgent-mode override. Run at startup; safe to run again. */
  expireUrgentMode(): Promise<number>
  /** What the level catalog currently says — the scheduling half of the review screen. */
  resolve(input: SchedulingPolicyInput): ImportanceResolution
  /** Re-read `importance_levels` after the user tunes a level. */
  refresh(): Promise<void>
}

export interface MemoryServiceOptions {
  repos: UnitOfWork
  /** The device's zone, so "same day" matches what the user sees. */
  timeZone?: string
  dayStartHour?: number
  scheduler?: Scheduler
}

/** The pieces that have to be rebuilt when the level rows or the exam set change. */
function build(
  repos: UnitOfWork,
  scheduler: Scheduler,
  catalog: ImportanceCatalog,
  exams: ExamOverrideSource,
  dayBoundary: DayBoundary,
) {
  const resolve = createImportanceResolver({ catalog, exams, dayBoundary })
  return {
    catalog,
    resolve,
    importanceMix: createImportanceMix({ repos, catalog }),
    simulate: createSimulateReschedule({ repos, resolve, scheduler }),
    apply: createRescheduleNow({ uow: repos, resolve, scheduler }),
  } satisfies {
    catalog: ImportanceCatalog
    resolve: (input: SchedulingPolicyInput) => ImportanceResolution
    importanceMix: ImportanceMixQuery
    simulate: SimulateReschedule
    apply: RescheduleNow
  }
}

export async function createMemoryService(options: MemoryServiceOptions): Promise<MemoryService> {
  const { repos } = options
  const dayStartHour = options.dayStartHour ?? DEFAULT_DAY_START_HOUR
  const scheduler =
    options.scheduler ??
    createFsrsScheduler({
      dayStartHour,
      ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
    })

  const dayBoundary: DayBoundary = {
    dayStartHour,
    timeZone: options.timeZone ?? DEFAULT_TIME_ZONE,
  }

  /**
   * The catalog and the exam set, read together.
   *
   * The exams are what make §7's urgent row and §8's cap real in the running app rather
   * than only in tests: without them `createImportanceResolver` falls back to
   * `NO_EXAM_OVERRIDES` and `cards.exam_id` changes nothing. Only dated exams still ahead
   * of now are loaded, and the set is rebuilt on `refresh` — sub-phase 10.1 replaces this
   * with the full phase machine behind the same `ExamOverrideSource`.
   */
  const load = async (): Promise<[ImportanceCatalog, ExamOverrideSource]> => {
    const [levels, upcoming] = await Promise.all([
      repos.importanceLevels.listOrdered(),
      repos.exams.listUpcoming(new Date()),
    ])
    return [createImportanceCatalog(levels), createExamOverrides(upcoming, { dayBoundary })]
  }

  // Rebuilt wholesale on `refresh` rather than mutated: the policy memoizes its
  // `SchedulingOptions` per resolution, and a stale memo would outlive the rows it came
  // from.
  let current = build(repos, scheduler, ...(await load()), dayBoundary)

  const startUrgentMode = createStartUrgentMode({ uow: repos })
  const expireUrgentMode = createExpireUrgentMode({ uow: repos })

  return {
    setItemImportance: (ids, level) => repos.knowledgeItems.setImportanceMany(ids, level),

    overrideCardImportance: (ids, level, expiresAt) =>
      repos.cards.overrideImportance(ids, level, expiresAt),

    importanceMix: () => current.importanceMix(),

    simulateReschedule: (selection) => current.simulate(selection),

    rescheduleNow: async (selection) => {
      const { impact, applied } = await current.apply({ ...selection, confirm: true })
      return { impact, applied }
    },

    startUrgentMode: (itemIds, hours) =>
      startUrgentMode({ itemIds, ...(hours === undefined ? {} : { hours }) }),

    expireUrgentMode: async () => {
      const cleared = await expireUrgentMode()
      if (cleared > 0) log.info(`[memory] cleared ${cleared} lapsed urgent-mode override(s)`)
      return cleared
    },

    resolve: (input) => current.resolve(input),

    refresh: async () => {
      current = build(repos, scheduler, ...(await load()), dayBoundary)
    },
  }
}
