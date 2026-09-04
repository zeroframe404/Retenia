import type { SchedulerProfile } from '../entities'
import type { Clock } from '../ports/clock'
import { systemClock } from '../ports/clock'
import type { OptimizerEvaluation, OptimizerTrainingResult } from '../ports/optimizer'
import type { ReviewLogRepository } from '../ports/review-log-repository'
import type { SchedulerProfileRepository } from '../ports/scheduler-profile-repository'
import { GLOBAL_SCHEDULER_SCOPE } from '../ports/scheduler-profile-repository'
import { clampParameters } from './formulas'
import { toOptimizerCsv } from './optimizer-csv'
import {
  type HealthCheck,
  healthCheck,
  type OptimizerOffer,
  optimizationOffer,
} from './optimizer-policy'
import type { SimulationResult, SimulatorConfig } from './simulator'
import { simulate } from './simulator'

/**
 * The optimizer use case: gather the history, and decide what to do with what came back
 * (`docs/spec/02-memory-system.md` §6, §16).
 *
 * Split in two halves on purpose, the same way `simulateReschedule` / `rescheduleNow` and
 * `composeSession` / `startSession` are. `prepare` only reads; `apply` only writes, and only
 * with an explicit confirmation. The training itself sits between them, in a job worker,
 * behind the `OptimizerTrainer` port — so this module never touches a native binary and can
 * be tested end to end in process.
 */

/** §15's `Optimizer`, as the spec spells it. `train` is the port's; `simulate` is core's own
 *  pure code, which is why the two halves are declared separately elsewhere. */
export interface Optimizer {
  train(input: OptimizerTrainingInputSource): Promise<OptimizationOutcome>
  simulate(config?: Partial<SimulatorConfig>): SimulationResult
}

export interface OptimizerRepositories {
  reviewLogs: Pick<ReviewLogRepository, 'listSince' | 'count'>
  schedulerProfiles: SchedulerProfileRepository
}

export interface OptimizerDeps {
  repos: OptimizerRepositories
  clock?: Clock
}

/** What the job is handed: the history, plus everything needed to bucket it into days. */
export interface OptimizerTrainingInputSource {
  scope: string
  csv: string
  nReviews: number
  profile: SchedulerProfile
}

/** The epoch the whole history is read from. FSRS has no memory before the first review,
 *  and a fixed floor keeps `listSince` from needing an "everything" mode. */
export const OPTIMIZER_HISTORY_EPOCH = new Date('2000-01-01T00:00:00.000Z')

/** Ceiling on the training set. §6's benchmark runs on collections far smaller than this;
 *  a user who somehow exceeds it trains on their most recent history. */
export const OPTIMIZER_MAX_REVIEWS = 500_000

export type PrepareOptimization = (scope?: string) => Promise<OptimizerTrainingInputSource>

/**
 * Read the history and render it as the trainer's input.
 *
 * Read-only by construction: the repository slice it is given has no write method on it,
 * so this cannot persist anything even by accident.
 */
export function createPrepareOptimization(deps: OptimizerDeps): PrepareOptimization {
  const { repos } = deps
  return async (scope = GLOBAL_SCHEDULER_SCOPE) => {
    const profile = await repos.schedulerProfiles.ensure(scope)
    const logs = await repos.reviewLogs.listSince(OPTIMIZER_HISTORY_EPOCH, undefined, {
      limit: OPTIMIZER_MAX_REVIEWS,
    })
    const csv = toOptimizerCsv(logs)
    // Counted from the rendered rows, not from `logs.length`: the CSV drops rating 0, and
    // `n_reviews` has to mean "what this model was trained on" for §16's 2ⁿ cadence to
    // compare like with like.
    const nReviews = csv.split('\n').length - 2
    return { scope, csv, nReviews, profile }
  }
}

export interface OptimizationOutcome {
  applied: boolean
  check: HealthCheck
  before: OptimizerEvaluation
  after: OptimizerEvaluation
  /** The profile as it stands after the decision — unchanged when the check rejected. */
  profile: SchedulerProfile
}

export type ApplyOptimization = (input: {
  scope?: string
  result: OptimizerTrainingResult
  /** In the schema, not a flag: an unconfirmed apply never happens. */
  confirm: true
  now?: Date
}) => Promise<OptimizationOutcome>

/**
 * Keep a trained model, if it is actually better.
 *
 * **This writes parameters and nothing else.** No card is touched, no due date moves, no
 * stability or difficulty is recomputed: §16's "never reschedule en masse except by
 * explicit action" and §7 rule 2 both say the new `w` applies from each card's next review.
 * `Scheduler.reschedule` exists for the explicit path (`memory.rescheduleNow`) and must not
 * be called from here — the temptation to "helpfully" re-apply the better model to the
 * existing queue is exactly what those two rules forbid.
 */
export function createApplyOptimization(deps: OptimizerDeps): ApplyOptimization {
  const { repos } = deps
  const clock = deps.clock ?? systemClock
  return async ({ scope = GLOBAL_SCHEDULER_SCOPE, result, confirm, now }) => {
    if (confirm !== true) {
      throw new RangeError('applyOptimization: confirm must be true')
    }
    const check = healthCheck(result.before, result.after)
    const profile = await repos.schedulerProfiles.ensure(scope)
    if (!check.improved) {
      return { applied: false, check, before: result.before, after: result.after, profile }
    }
    const w = clampParameters([...result.w])
    const saved = await repos.schedulerProfiles.saveTrained(scope, {
      w,
      decay: w[20] as number,
      trainedAt: now ?? clock.now(),
      nReviews: result.nReviews,
      logLoss: result.after.logLoss,
      rmse: result.after.rmse,
    })
    return { applied: true, check, before: result.before, after: result.after, profile: saved }
  }
}

export interface OptimizerStatus {
  profile: SchedulerProfile
  /** Live, non-manual reviews available to train on. */
  nReviews: number
  offer: OptimizerOffer
}

export type OptimizerStatusQuery = (scope?: string) => Promise<OptimizerStatus>

/** What the settings screen shows: the model in force, its quality, and whether it is time
 *  to retrain (§13's "model quality and the date of the last optimization"). */
export function createOptimizerStatus(deps: OptimizerDeps): OptimizerStatusQuery {
  const { repos } = deps
  const clock = deps.clock ?? systemClock
  return async (scope = GLOBAL_SCHEDULER_SCOPE) => {
    const [profile, nReviews] = await Promise.all([
      repos.schedulerProfiles.ensure(scope),
      repos.reviewLogs.count({ excludeManual: true }),
    ])
    return {
      profile,
      nReviews,
      offer: optimizationOffer({ nReviews, profile, now: clock.now() }),
    }
  }
}

/** §15's composed `Optimizer`, for a caller that wants both halves behind one object. */
export function createOptimizer(
  deps: OptimizerDeps & {
    trainer: { train(input: OptimizerTrainingInputSource): Promise<OptimizerTrainingResult> }
  },
): Optimizer {
  const apply = createApplyOptimization(deps)
  return {
    train: async (input) => {
      const result = await deps.trainer.train(input)
      return apply({ scope: input.scope, result, confirm: true })
    },
    simulate: (config) => simulate(undefined, undefined, config),
  }
}
