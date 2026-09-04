import type {
  Card,
  ComposeSessionQuery,
  DayBoundary,
  DomainEvent,
  DomainEventPublisher,
  DueHistogram,
  ExamOverrideSource,
  Forecast,
  ForecastQuery,
  ImportanceCatalog,
  ImportanceLevel,
  ImportanceLevelPatch,
  ImportanceMix,
  ImportanceMixQuery,
  ImportanceResolution,
  JsonObject,
  KnowledgeItem,
  OptimizationOutcome,
  OptimizerStatus,
  RescheduleImpact,
  RescheduleNow,
  RescheduleSelection,
  RetentionWindow,
  ReviewCard,
  Scheduler,
  SchedulerProfile,
  SchedulingOptions,
  SchedulingPolicyInput,
  SchedulingPreview,
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
  StatsOverview,
  StatsQueries,
  StatsQueryOptions,
  TrueRetention,
  UnitOfWork,
  UrgentModeHours,
  UrgentModeResult,
} from '@retenia/core'
import {
  buildDueHistogram,
  CARD_STATE,
  createComposeSession,
  createExamOverrides,
  createExpireUrgentMode,
  createForecast,
  createFsrsScheduler,
  createImportanceCatalog,
  createImportanceMix,
  createImportanceResolver,
  createLoadBalancer,
  createRescheduleNow,
  createReviewCard,
  createSimulateReschedule,
  createStartSession,
  createStartUrgentMode,
  createStatsQueries,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_TIME_ZONE,
  disperseSiblingDueDates,
  GLOBAL_SCHEDULER_SCOPE,
  LOAD_BALANCE_HORIZON_DAYS,
  parametersFromProfile,
  schedulerConfigFromProfile,
  schedulingOptionsFromParameters,
} from '@retenia/core'
import { log } from '../logging/log'
import { createOptimizerService } from './optimizer-service'

/** The four v1 flashcard templates the review screen renders (`docs/spec/04-path-generation.md`
 *  `Flashcard.v1`). Cycled by `seedReviewDemo` so a seeded session exercises every renderer. */
const DEMO_TEMPLATES = ['basic', 'reverse', 'cloze:c1', 'type_in'] as const

function demoFields(index: number, template: (typeof DEMO_TEMPLATES)[number]): JsonObject {
  const n = index + 1
  switch (template) {
    case 'cloze:c1':
      return {
        cloze_text: `Retenia demo card ${n}: the capital of France is {{c1::Paris::country}}.`,
      }
    case 'type_in':
      return { front: `Type the answer — demo card ${n}`, back: `answer-${n}` }
    default:
      return { front: `Demo front ${n}`, back: `Demo back ${n}` }
  }
}

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
  /** Marks or clears the manual leech flag ("Mark as leech / lower importance" menu). */
  setCardLeech(ids: readonly string[], leech: boolean): Promise<number>
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
  /** The entry the user is on, its knowledge item and the four-button interval preview —
   *  everything the review screen renders one card with. `item`/`preview` are `null` for a
   *  reinforcement entry or once the queue (final drill included) is exhausted. */
  sessionNext(): Promise<{
    entry: SessionEntry | null
    progress: SessionRunnerState
    item: KnowledgeItem | null
    preview: SchedulingPreview | null
  }>
  sessionAnswer(
    input: SessionAnswerInput,
  ): Promise<{ result: SessionAnswerResult; progress: SessionRunnerState }>
  sessionSkip(): Promise<SessionRunnerState>
  sessionUndo(): Promise<{ undone: SessionUndoResult | null; progress: SessionRunnerState }>
  sessionFinish(): Promise<SessionSummary>
  /** §13: cards and minutes per day, per level, with and without new. */
  forecast(days: number): Promise<Forecast>

  // --- statistics (§13, rows 1–6) ---

  /** Everything the statistics screen's six cards need, in one read. */
  stats(options?: StatsQueryOptions): Promise<StatsOverview>
  /** One true-retention window on its own — the card's day/week/month/year switcher. */
  trueRetention(window: RetentionWindow): Promise<TrueRetention>
  /** Dev/e2e only — see `memory.seedReviewDemo`'s doc in `packages/ipc-contract`. */
  seedReviewDemo(count: number): Promise<{ itemIds: string[]; cardIds: string[] }>

  // --- the scheduler profile and its optimizer (§6, §16) ---

  /** The parameters in force, their quality, and whether it is time to retrain. */
  optimizerStatus(): Promise<OptimizerStatus>
  /** Stage the history and queue a training run. */
  startOptimization(): Promise<{ jobId: string; nReviews: number }>
  /** Keep what a finished run produced, if the health check accepts it. */
  applyOptimization(jobId: string): Promise<OptimizationOutcome>
  /** The steps, fuzz and interval cap the profile carries. */
  updateProfile(patch: SchedulerProfilePatch): Promise<SchedulerProfile>
  /** Tune one importance level (§7): retention, cap, leech threshold and action. */
  setLevel(level: ImportanceLevel, patch: ImportanceLevelPatch): Promise<boolean>
  /** Sub-phase 4.6's "disperse siblings" (§4): spread one item's cards onto different days. */
  disperseSiblings(itemId: string): Promise<number>
}

/** The `scheduler_profiles` columns the settings screen may write. `w` is not among them:
 *  the optimizer owns the parameters, and hand-editing 21 numbers is not a feature. */
export type SchedulerProfilePatch = Partial<
  Pick<SchedulerProfile, 'learningSteps' | 'relearningSteps' | 'enableFuzz' | 'maximumInterval'>
>

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

/**
 * How far ahead the load balancer tracks contention, and how many due rows it will read.
 *
 * A year, because `maximum_interval` can be 36,500 days and a fuzz window landing past a
 * year has nothing meaningful to be balanced against; the row cap is the same order as the
 * forecast's, so a large collection cannot turn opening a session into an unbounded read.
 */
const HISTOGRAM_HORIZON_DAYS = LOAD_BALANCE_HORIZON_DAYS
const HISTOGRAM_MAX_ROWS = 50_000

async function loadHistogram(repos: UnitOfWork, boundary: DayBoundary): Promise<DueHistogram> {
  const now = new Date()
  const due = await repos.cards.listDueBetween(
    now,
    new Date(now.getTime() + HISTOGRAM_HORIZON_DAYS * 86_400_000),
    { limit: HISTOGRAM_MAX_ROWS },
  )
  return buildDueHistogram(due, { now, boundary, horizonDays: HISTOGRAM_HORIZON_DAYS })
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
  base: SchedulingOptions,
) {
  // `base` is the only way the stored profile's steps and fuzz, the load balancer and the
  // easy-day calendar reach a scheduling decision: `createImportanceResolver` spreads it
  // into every `SchedulingOptions` it memoizes, and importance then overrides only the
  // retention and the interval cap (§7).
  const resolve = createImportanceResolver({ catalog, exams, dayBoundary, base })
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

  const dayBoundary: DayBoundary = {
    dayStartHour,
    timeZone: options.timeZone ?? DEFAULT_TIME_ZONE,
  }

  /**
   * The stored FSRS parameters (§6, §14).
   *
   * Read here rather than defaulted, because this is what makes an accepted optimization
   * mean anything: `scheduler_profiles.w` is the model every interval is computed from, and
   * a service built on `DEFAULT_FSRS_W` would quietly ignore every training run the user
   * ever paid for.
   */
  let profile = await repos.schedulerProfiles.ensure(GLOBAL_SCHEDULER_SCOPE)

  /**
   * The live scheduler, behind a stable facade.
   *
   * An accepted optimization changes `w`, and `FsrsScheduler` memoizes `fsrs()` instances
   * per options — so the instance has to be replaced wholesale, not mutated. Every consumer
   * (the review use case, the session composer, the reschedule preview) holds this facade
   * instead, so `refresh` can swap what is underneath without rebuilding any of them.
   */
  let activeScheduler: Scheduler =
    options.scheduler ??
    createFsrsScheduler(schedulerConfigFromProfile(profile, { timeZone: dayBoundary.timeZone }))
  const scheduler: Scheduler = {
    get id() {
      return activeScheduler.id
    },
    preview: (card, now, opts) => activeScheduler.preview(card, now, opts),
    apply: (card, now, grade, opts) => activeScheduler.apply(card, now, grade, opts),
    retrievability: (card, at) => activeScheduler.retrievability(card, at),
    intervalFor: (retention, state) => activeScheduler.intervalFor(retention, state),
    reschedule: (card, history, opts) => activeScheduler.reschedule(card, history, opts),
    rollback: (card, log) => activeScheduler.rollback(card, log),
    forget: (card, now, resetCounts) => activeScheduler.forget(card, now, resetCounts),
    postpone: (card, now, due) => activeScheduler.postpone(card, now, due),
  }

  /**
   * The due-date histogram the load balancer reads (§3.2 (i), §15).
   *
   * One read, not one per call: `pickDay` asks the balancer once per grade for every card
   * previewed, and a query per call would turn opening a session into thousands of round
   * trips. Rebuilt on `refresh`, and kept current in between by the `card.reviewed`
   * subscriber below.
   */
  let histogram = await loadHistogram(repos, dayBoundary)

  /** The profile's steps and fuzz, plus the balancer and the easy-day calendar. */
  const loadBase = async (): Promise<SchedulingOptions> => {
    const [loadBalance, easyDays, easyDates] = await Promise.all([
      repos.settings.get('review.loadBalance'),
      repos.settings.get('review.easyDays'),
      repos.settings.get('review.easyDates'),
    ])
    const now = new Date()
    return schedulingOptionsFromParameters(parametersFromProfile(profile), {
      ...(loadBalance
        ? { loadBalance: createLoadBalancer(histogram, { now, boundary: dayBoundary }) }
        : {}),
      easyDays,
      easyDates,
    })
  }
  let base = await loadBase()

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
  let current = build(repos, scheduler, ...(await load()), dayBoundary, base)

  const optimizer = createOptimizerService({ repos, timeZone: dayBoundary.timeZone })

  const startUrgentMode = createStartUrgentMode({ uow: repos })
  const expireUrgentMode = createExpireUrgentMode({ uow: repos })

  const configured: DomainEventPublisher = options.events ?? {
    publish: (event: DomainEvent) => {
      log.debug(
        event.type === 'card.reviewed'
          ? `[memory] ${event.type} ${event.card.id} rating=${event.log.rating}`
          : `[memory] ${event.type} ${event.card.id} ${event.decision.stage} lapses=${event.decision.lapses}`,
      )
    },
  }

  /**
   * The one place that knows a review really happened, so the one place that may count it.
   *
   * `createLoadBalancer` is deliberately pure: `preview` asks it for all four grades of
   * every card shown, and a balancer that booked the day it returned would record three
   * reviews that never happen for each one that does. Booking here instead is also what
   * makes consecutive reviews in one session spread out rather than all piling onto the
   * same trough day.
   */
  const events: DomainEventPublisher = {
    publish: (event: DomainEvent) => {
      if (event.type === 'card.reviewed') {
        histogram.unnote(event.previous.due)
        histogram.note(event.card.due)
      }
      configured.publish(event)
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
    // The full resolution, not just its options: §4's leech thresholds and actions are
    // columns of the same importance level, and passing it also collapses what used to be
    // two resolves per review into one.
    resolve: (input) => current.resolve(input),
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
   * §13's first six rows.
   *
   * The forecast is handed in rather than rebuilt: row 6 *is* sub-phase 4.3's query, and a
   * second instance would be a second thing to keep in step with this one.
   *
   * Rebuilt by `refresh`, like `current`, because row 2 compares true retention against
   * each level's **desired** retention: tuning a level and then reading a card that still
   * shows the old target — and its > 5 pp alert — would be worse than showing nothing.
   */
  const buildStats = (): StatsQueries =>
    createStatsQueries({
      repos: repos.stats,
      catalog: current.catalog,
      forecast,
      dayBoundary,
    })
  let stats = buildStats()

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

  // Named, so `applyOptimization` can call `refresh` on itself after an accepted model.
  const service: MemoryService = {
    setItemImportance: (ids, level) => repos.knowledgeItems.setImportanceMany(ids, level),

    overrideCardImportance: (ids, level, expiresAt) =>
      repos.cards.overrideImportance(ids, level, expiresAt),

    setCardLeech: async (ids, leech) => {
      let updated = 0
      for (const id of ids) {
        await repos.cards.setLeech(id, leech)
        updated += 1
      }
      return updated
    },

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

    optimizerStatus: () => optimizer.status(),

    startOptimization: () => optimizer.start(),

    /**
     * Apply a finished run, then rebuild everything derived from the profile.
     *
     * The refresh is the point: `w` is what every interval is computed from, and
     * `FsrsScheduler` memoizes its `fsrs()` instances, so a service left holding the old
     * one would keep scheduling on the model the user just replaced.
     */
    applyOptimization: async (jobId) => {
      const outcome = await optimizer.apply(jobId)
      if (outcome.applied) await service.refresh()
      return outcome
    },

    updateProfile: async (patch) => {
      const current = await repos.schedulerProfiles.ensure(GLOBAL_SCHEDULER_SCOPE)
      const saved = await repos.schedulerProfiles.update(current.id, patch)
      await service.refresh()
      return saved
    },

    setLevel: async (level, patch) => {
      await repos.importanceLevels.updateByName(level, patch)
      // The catalog and its memoized `SchedulingOptions` are rebuilt wholesale: a level's
      // retention is baked into every options object the resolver cached.
      await service.refresh()
      return true
    },

    /**
     * §4: spread one item's cards onto different days.
     *
     * Applied through `Scheduler.postpone`, which moves `due` without touching S or D and
     * writes a rating 0 log — so a dispersal never reaches the optimizer as an answer.
     */
    disperseSiblings: async (itemId) => {
      const cards = await repos.cards.findByItem(itemId)
      const now = new Date()
      const moves = disperseSiblingDueDates({ cards, now, boundary: dayBoundary })
      for (const move of moves) {
        await reviewCard({ cardId: move.cardId, rating: 0, due: move.to, now })
      }
      return moves.length
    },

    refresh: async () => {
      // The profile first: an accepted optimization changed `w`, and both the scheduler
      // instance and the base options are derived from it.
      profile = await repos.schedulerProfiles.ensure(GLOBAL_SCHEDULER_SCOPE)
      if (options.scheduler === undefined) {
        activeScheduler = createFsrsScheduler(
          schedulerConfigFromProfile(profile, { timeZone: dayBoundary.timeZone }),
        )
      }
      histogram = await loadHistogram(repos, dayBoundary)
      base = await loadBase()
      current = build(repos, scheduler, ...(await load()), dayBoundary, base)
      stats = buildStats()
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

    sessionNext: async () => {
      const current_ = active()
      const entry = current_.next()
      if (entry === null || entry.kind === 'reinforcement') {
        return { entry, progress: current_.state(), item: null, preview: null }
      }
      const item = (await repos.knowledgeItems.findById(entry.card.itemId)) ?? null
      const preview = scheduler.preview(entry.card, new Date(), entry.options)
      return { entry, progress: current_.state(), item, preview }
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

    stats: (options = {}) => stats.overview(options),

    trueRetention: (window) => stats.trueRetention(window),

    seedReviewDemo: async (count) => {
      const now = new Date()
      const itemIds: string[] = []
      const cardIds: string[] = []
      for (let i = 0; i < count; i++) {
        const template = DEMO_TEMPLATES[
          i % DEMO_TEMPLATES.length
        ] as (typeof DEMO_TEMPLATES)[number]
        const item = await repos.knowledgeItems.create({
          lessonId: null,
          topicId: null,
          kind: 'fact',
          fields: demoFields(i, template),
          sourceId: null,
          annotationId: null,
          locator: null,
          asOf: null,
          importance: 'normal',
          status: 'active',
          createdBy: 'user',
          tags: [],
        })
        const card: Card = await repos.cards.create({
          itemId: item.id,
          template,
          payload: null,
          due: new Date(now.getTime() - 60_000),
          stability: 3,
          difficulty: 5,
          scheduledDays: 1,
          learningSteps: 0,
          reps: 1,
          lapses: 0,
          state: CARD_STATE.Review,
          lastReview: new Date(now.getTime() - 86_400_000),
          suspended: false,
          buriedUntil: null,
          leech: false,
          importanceOverride: null,
          importanceOverrideExpiresAt: null,
          examId: null,
        })
        itemIds.push(item.id)
        cardIds.push(card.id)
      }
      log.info(`[memory] seeded ${count} demo review card(s)`)
      return { itemIds, cardIds }
    },
  }
  return service
}
