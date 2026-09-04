import type { JobAbortSignal } from '../jobs/definition'

/**
 * Training FSRS parameters on a review history (`docs/spec/02-memory-system.md` §6, §16).
 *
 * A port because the training itself is `fsrs-rs`, reached through
 * `@open-spaced-repetition/binding` — a native module, which `packages/core` may not import
 * (CLAUDE.md). The adapter runs in the desktop app's job worker; everything core needs to
 * decide *whether to keep* a trained model lives in `memory/optimizer-policy.ts` and is
 * pure.
 *
 * The simulator half of §15's `Optimizer` is not here: it is core's own pure code, in
 * `memory/simulator.ts`. A port whose implementation lives in the package that declares it
 * would be a port in name only.
 */

/** How far along a training run is. The binding reports no epoch progress, so these are
 *  the stages the job moves through instead. */
export const OPTIMIZER_STAGES = [
  'reading',
  'converting',
  'evaluating_before',
  'training',
  'evaluating_after',
] as const
export type OptimizerStage = (typeof OPTIMIZER_STAGES)[number]

export interface OptimizerEvaluation {
  /** The training objective: every review is a binary outcome (§6). Lower is better. */
  logLoss: number
  /** Root mean square error over calibration bins — §6's `RMSE(bins)`. */
  rmse: number
}

export interface OptimizerTrainingInput {
  /** The history in `fsrs-optimizer` CSV form (`memory/optimizer-csv.ts`). */
  csv: string
  /** `review.dayStartHour`: the hour a study day rolls over. Anki and `fsrs-optimizer`
   *  both use 4. */
  nextDayStartsAt: number
  /** IANA zone the reviews are bucketed into days by. */
  timeZone: string
}

export interface OptimizerTrainingOptions {
  /** The parameters in force, measured as the `before` side of the health check. */
  currentW: readonly number[]
  enableShortTerm: boolean
  /** How many relearning steps the profile uses — the trainer models same-day steps. */
  numRelearningSteps: number
  signal?: JobAbortSignal
  onStage?: (stage: OptimizerStage, fraction: number) => void
}

export interface OptimizerTrainingResult {
  /** The 21 trained parameters, clamped to §3.3's ranges. */
  w: readonly number[]
  /** `w20`, which `scheduler_profiles.decay` mirrors. */
  decay: number
  /**
   * How the *current* parameters score, and how the trained ones do.
   *
   * Both are measured by the adapter, on the same converted item set, in the same call.
   * That is not an implementation detail: comparing a fresh score against the `log_loss`
   * stored by an earlier run would compare two different item sets, and could let a
   * genuinely worse model through the health check.
   */
  before: OptimizerEvaluation
  after: OptimizerEvaluation
  /** Rows in the training CSV. */
  nReviews: number
  /** FSRS items the rows converted into — fewer, since one item is a card's whole history. */
  nItems: number
}

export interface OptimizerTrainer {
  train(
    input: OptimizerTrainingInput,
    options: OptimizerTrainingOptions,
  ): Promise<OptimizerTrainingResult>
}
