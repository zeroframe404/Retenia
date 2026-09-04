import { readFile } from 'node:fs/promises'
import {
  clampParameters,
  type JobContext,
  type JobDefinition,
  type OptimizerEvaluation,
  type OptimizerStage,
  registerJob,
  timeZoneOffsetAtMs,
} from '@retenia/core'
import { confinePath, JobCancelledError } from './confine'

/**
 * Training FSRS parameters on the user's own history
 * (`docs/spec/02-memory-system.md` §6, §16), in a worker.
 *
 * The training is `fsrs-rs`, reached through `@open-spaced-repetition/binding` — an N-API
 * module with prebuilds for every platform we ship and a `wasm32-wasi` build behind the
 * same API for any we do not. It is an **optional** dependency: an install without it must
 * fail *this job*, with a message a user can act on, rather than the whole bundle.
 *
 * What this job deliberately does not do is decide anything. It measures the current
 * parameters and the trained ones and hands both back; `main` applies §16's health check
 * and writes the profile, because a worker never touches SQLite.
 */

/** The package the trainer lives in. A constant so the error message and the dynamic
 *  import cannot drift apart. */
const BINDING = '@open-spaced-repetition/binding'

export class OptimizerUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `The FSRS optimizer is not available on this platform: ${BINDING} could not be loaded. ` +
        'Reinstall the app, or install its wasm32-wasi build.',
    )
    this.name = 'OptimizerUnavailableError'
    this.cause = cause
  }
}

/**
 * The job's result, as it is stored in `jobs.result`.
 *
 * Structurally `OptimizerTrainingResult`, but spelled with mutable arrays and plain
 * objects: the row is a JSON column, and `readonly number[]` is not a `JsonValue`. Main
 * widens it back to the port's type before handing it to the health check.
 */
export type FsrsOptimizeResult = {
  w: number[]
  decay: number
  before: { logLoss: number; rmse: number }
  after: { logLoss: number; rmse: number }
  nReviews: number
  nItems: number
}

export interface FsrsOptimizeInput {
  /** Path to the fsrs-optimizer CSV, inside a directory the worker may read. */
  path: string
  /** The parameters in force — the `before` side of the health check. */
  currentW: number[]
  /** `review.dayStartHour`; Anki and `fsrs-optimizer` both use 4. */
  nextDayStartsAt: number
  timeZone: string
  enableShortTerm: boolean
  numRelearningSteps: number
}

/**
 * `timeout` is a **wall-clock budget the call always consumes, not a quality knob.**
 *
 * Measured against v0.5.0 on the same input: 200 ms, 2 s and 15 s all returned byte-identical
 * parameters and the same log loss, while taking 296 ms, 2,063 ms and 15,081 ms. Raising
 * it buys nothing and costs the user exactly the difference. Unset it defaults to 500 ms;
 * this is that, stated, so a future reader does not "fix" it upward.
 */
const TRAIN_TIMEOUT_MS = 500

/** Where each stage sits on the 0–1 bar. The binding reports no epoch progress — its
 *  `progress` callback never fires — so the stages are the progress. */
const STAGES: ReadonlyArray<readonly [OptimizerStage, number]> = [
  ['reading', 0.1],
  ['converting', 0.3],
  ['evaluating_before', 0.5],
  ['training', 0.7],
  ['evaluating_after', 0.9],
]

function stageFraction(stage: OptimizerStage): number {
  return STAGES.find(([name]) => name === stage)?.[1] ?? 0
}

/** The binding's `offsetProvider`, in the minutes it wants, from core's DST-correct
 *  helper — rather than a second `Intl.DateTimeFormat` dance copied from its README. */
function offsetMinutes(ms: number, timeZone: string): number {
  return timeZoneOffsetAtMs(ms, timeZone) / 60_000
}

function toEvaluation(value: { logLoss: number; rmseBins: number }): OptimizerEvaluation {
  return { logLoss: value.logLoss, rmse: value.rmseBins }
}

export function createFsrsOptimizeJob(
  roots: readonly string[],
): JobDefinition<FsrsOptimizeInput, FsrsOptimizeResult> {
  return {
    type: 'fsrsOptimize',
    // Training is minutes of CPU at worst and is always re-runnable from the button, so a
    // failed attempt is not worth retrying automatically against a CSV that may be gone.
    defaultMaxAttempts: 1,
    parseInput: (payload) => {
      const path = payload.path
      if (typeof path !== 'string' || path.length === 0) {
        throw new Error('fsrsOptimize needs a non-empty string "path"')
      }
      const currentW = payload.currentW
      if (
        !Array.isArray(currentW) ||
        currentW.length !== 21 ||
        currentW.some((v) => typeof v !== 'number')
      ) {
        throw new Error('fsrsOptimize needs "currentW" as 21 numbers')
      }
      const nextDayStartsAt = payload.nextDayStartsAt
      if (typeof nextDayStartsAt !== 'number' || nextDayStartsAt < 0 || nextDayStartsAt > 23) {
        throw new Error('fsrsOptimize needs "nextDayStartsAt" in 0..23')
      }
      const timeZone = payload.timeZone
      if (typeof timeZone !== 'string' || timeZone.length === 0) {
        throw new Error('fsrsOptimize needs a non-empty string "timeZone"')
      }
      return {
        path,
        currentW: currentW as number[],
        nextDayStartsAt,
        timeZone,
        enableShortTerm: payload.enableShortTerm !== false,
        numRelearningSteps:
          typeof payload.numRelearningSteps === 'number' ? payload.numRelearningSteps : 1,
      }
    },
    run: async (input, ctx) =>
      train(await confinePath(roots, input.path, 'fsrsOptimize'), input, ctx),
  }
}

async function train(
  path: string,
  input: FsrsOptimizeInput,
  ctx: JobContext,
): Promise<FsrsOptimizeResult> {
  const stage = (name: OptimizerStage, message: string): void => {
    if (ctx.signal.aborted) throw new JobCancelledError()
    ctx.progress(stageFraction(name), message)
  }

  stage('reading', 'reading the review history')
  const csv = await readFile(path)

  // Dynamic, so a build whose optional dependency did not install still loads: only this
  // job fails, and with a message that says what to do about it.
  let binding: typeof import('@open-spaced-repetition/binding')
  try {
    binding = await import(BINDING)
  } catch (cause) {
    throw new OptimizerUnavailableError(cause)
  }

  stage('converting', 'converting to FSRS items')
  const items = binding.convertCsvToFsrsItems(
    csv,
    input.nextDayStartsAt,
    input.timeZone,
    offsetMinutes,
  )
  if (items.length === 0) {
    throw new Error('fsrsOptimize: the review history converted to no trainable items')
  }

  /**
   * Both evaluations run here, on the same converted items.
   *
   * Not an implementation detail: scoring the trained model here and comparing it against
   * the `log_loss` a previous run stored would compare two different item sets, and could
   * let a genuinely worse model through §16's health check.
   */
  stage('evaluating_before', 'measuring the current parameters')
  const before = toEvaluation(new binding.FSRSBinding([...input.currentW]).evaluate(items))

  stage('training', 'training')
  const trained = await binding.computeParameters(items, {
    enableShortTerm: input.enableShortTerm,
    numRelearningSteps: input.numRelearningSteps,
    timeout: TRAIN_TIMEOUT_MS,
  })
  const w = clampParameters([...trained])

  stage('evaluating_after', 'measuring the trained parameters')
  const after = toEvaluation(new binding.FSRSBinding([...w]).evaluate(items))

  ctx.progress(1, 'done')
  return {
    w,
    decay: w[20] as number,
    before,
    after,
    // Rows, not bytes: the header does not count, and neither does a trailing newline.
    nReviews:
      csv
        .toString('utf8')
        .split('\n')
        .filter((line) => line.length > 0).length - 1,
    nItems: items.length,
  }
}

export const registerFsrsOptimizeJob = (roots: readonly string[]) =>
  registerJob(createFsrsOptimizeJob(roots))
