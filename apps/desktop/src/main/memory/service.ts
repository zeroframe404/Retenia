import type {
  ComposeSessionQuery,
  DayBoundary,
  DomainEvent,
  DomainEventPublisher,
  ExamOverrideSource,
  Forecast,
  ForecastQuery,
  ImportanceCatalog,
  ImportanceLevel,
  ImportanceMix,
  ImportanceMixQuery,
  ImportanceResolution,
  RescheduleImpact,
  RescheduleNow,
  RescheduleSelection,
  ReviewCard,
  Scheduler,
  SchedulingPolicyInput,
  SessionAnswerInput,
  SessionAnswerResult,
  SessionEntry,
  SessionPlan,
  SessionRunner,
  SessionRunnerState,
  SessionSettings,
  SessionSummary,
  SessionUndoResult,
  SimulateReschedule,
  StartSession,
  StartSessionResult,
  UnitOfWork,
  UrgentModeHours,
  UrgentModeResult,
} from '@retenia/core'
import {
  createComposeSession,
  createExamOverrides,
  createExpireUrgentMode,
  createForecast,
  createFsrsScheduler,
  createImportanceCatalog,
  createImportanceMix,
  createImportanceResolver,
  createRescheduleNow,
  createReviewCard,
  createSimulateReschedule,
  createStartSession,
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

  // --- the daily session (§12) ---

  /** Compose today without touching anything — the "today" screen. */
  planSession(settings?: SessionSettings): Promise<SessionPlan>
  /** Start, or resume a session left open earlier today. Applies burials and postpones. */
  startSession(settings?: SessionSettings): Promise<StartSessionResult>
  sessionNext(): { entry: SessionEntry | null; progress: SessionRunnerState }
  sessionAnswer(
    input: SessionAnswerInput,
  ): Promise<{ result: SessionAnswerResult; progress: SessionRunnerState }>
  sessionSkip(): Promise<SessionRunnerState>
  sessionUndo(): Promise<{ undone: SessionUndoResult | null; progress: SessionRunnerState }>
  sessionFinish(): Promise<SessionSummary>
  /** §13: cards and minutes per day, per level, with and without new. */
  forecast(days: number): Promise<Forecast>
}

export interface MemoryServiceOptions {
  repos: UnitOfWork
  /** The device's zone, so "same day" matches what the user sees. */
  timeZone?: string
  dayStartHour?: number
  scheduler?: Scheduler
  /**
   * Where `card.reviewed` goes. The default logs at debug level and nothing more: there is
   * no subscriber yet, and sub-phase 13.1 (XP, streaks) is the first thing that will want
   * one. Injectable so a test can assert the event without a window.
   */
  events?: DomainEventPublisher
}

/** No session has been started, or the last one was finished. */
export class NoActiveSessionError extends Error {
  override readonly name = 'NoActiveSessionError'
  constructor() {
    super('No review session is running: call session.start first')
  }
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

  const events: DomainEventPublisher = options.events ?? {
    publish: (event: DomainEvent) => {
      log.debug(`[memory] ${event.type} ${event.card.id} rating=${event.log.rating}`)
    },
  }

  /**
   * The daily session (§12).
   *
   * The policy is `current.resolve`, not a second `createImportanceSchedulingPolicy`: the
   * resolver already carries the live catalog *and* the exam overrides, and building a
   * parallel one would let a review be scheduled from a catalog the queue was not composed
   * with. `refresh` swaps `current`, and both read it through the same closure.
   */
  const reviewCard: ReviewCard = createReviewCard({
    uow: repos,
    scheduler,
    policy: { optionsFor: (input) => current.resolve(input).options },
    events,
  })

  const compose: ComposeSessionQuery = createComposeSession({
    repos,
    scheduler,
    resolve: (input) => current.resolve(input),
    catalog: current.catalog,
    // Urgent mode's own doc: sweep the lapsed overrides before composing, or a window that
    // closed overnight still orders the queue.
    expireUrgentMode: async (at) => expireUrgentMode(at),
    dayBoundary,
  })

  const startSession: StartSession = createStartSession({
    uow: repos,
    compose,
    reviewCard,
    scheduler,
    resolve: (input) => current.resolve(input),
    catalog: current.catalog,
    dayBoundary,
  })

  const forecast: ForecastQuery = createForecast({
    repos,
    catalog: current.catalog,
    dayBoundary,
  })

  /**
   * The session the renderer is driving.
   *
   * One at a time, and held in main rather than rebuilt per IPC call: the runner owns the
   * per-card timer and the final-drill queue, and re-reading the row on every `next()` would
   * lose both. It survives a renderer reload because it lives here; it does not survive the
   * process, which is what `review_sessions` is for.
   */
  let runner: SessionRunner | null = null
  const active = (): SessionRunner => {
    if (runner === null) throw new NoActiveSessionError()
    return runner
  }

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

    planSession: (settings = {}) => compose(settings),

    startSession: async (settings = {}) => {
      const result = await startSession({ settings, confirm: true })
      runner = result.runner
      log.info(
        result.resumed
          ? `[memory] resumed session ${result.session.id} at ${result.runner.state().cursor}`
          : `[memory] started session ${result.session.id}: ${result.entries.length} entries, ` +
              `${result.postponed} postponed, ${result.burials} buried`,
      )
      return result
    },

    sessionNext: () => {
      const current_ = active()
      return { entry: current_.next(), progress: current_.state() }
    },

    sessionAnswer: async (input) => {
      const current_ = active()
      const result = await current_.answer(input)
      return { result, progress: current_.state() }
    },

    sessionSkip: async () => {
      const current_ = active()
      await current_.skip()
      return current_.state()
    },

    sessionUndo: async () => {
      const current_ = active()
      const undone = await current_.undo()
      return { undone, progress: current_.state() }
    },

    sessionFinish: async () => {
      const summary = await active().finish()
      runner = null
      log.info(
        `[memory] finished session ${summary.sessionId}: ${summary.reviewed} reviewed, ` +
          `${summary.minutes.toFixed(1)} min`,
      )
      return summary
    },

    forecast: (days) => forecast(days),
  }
}
