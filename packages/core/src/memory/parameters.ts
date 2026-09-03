import type { SchedulerProfile } from '../entities'
import { assertParameters } from './formulas'
import type { FsrsSchedulerConfig } from './fsrs-scheduler'
import type { SchedulingOptions, StepUnit } from './types'

/**
 * The FSRS-6 defaults (`docs/spec/02-memory-system.md` §3.1, §4) and the small bridges
 * between a stored `SchedulerProfile`, the scheduler's parameters and the per-review
 * `SchedulingOptions`.
 */

/** `ts-fsrs` 5.4.2's `default_w` = py-fsrs 6's `DEFAULT_PARAMETERS`. */
export const DEFAULT_FSRS_W: readonly number[] = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
])

/** The `FSRSParameters` of §5, in the domain's casing. */
export interface FsrsParameters {
  /** `w0…w20`. */
  w: readonly number[]
  requestRetention: number
  maximumInterval: number
  learningSteps: readonly StepUnit[]
  relearningSteps: readonly StepUnit[]
  enableFuzz: boolean
  enableShortTerm: boolean
}

export const DEFAULT_LEARNING_STEPS: readonly StepUnit[] = Object.freeze(['1m', '10m'])
export const DEFAULT_RELEARNING_STEPS: readonly StepUnit[] = Object.freeze(['10m'])

export const DEFAULT_FSRS_PARAMETERS: Readonly<FsrsParameters> = Object.freeze({
  w: DEFAULT_FSRS_W,
  requestRetention: 0.9,
  maximumInterval: 36500,
  learningSteps: DEFAULT_LEARNING_STEPS,
  relearningSteps: DEFAULT_RELEARNING_STEPS,
  // `ts-fsrs` defaults fuzz to off; the spec (§3.2 (i)) wants it on.
  enableFuzz: true,
  enableShortTerm: true,
})

/** What the `Normal` level asks for, and what the stub policy hands out until 4.2. */
export const DEFAULT_SCHEDULING_OPTIONS: Readonly<SchedulingOptions> = Object.freeze({
  desiredRetention: 0.9,
  maxIntervalDays: 36500,
  learningSteps: DEFAULT_LEARNING_STEPS,
  relearningSteps: DEFAULT_RELEARNING_STEPS,
  fuzz: true,
})

const STEP_UNIT = /^(\d+)([mhd])$/

/** `1m`, `10m`, `1h`, `1d` — what `ts-fsrs` accepts as a step. */
export function isStepUnit(value: unknown): value is StepUnit {
  return typeof value === 'string' && STEP_UNIT.test(value)
}

/** A step's length in minutes. */
export function stepUnitToMinutes(step: StepUnit): number {
  const match = STEP_UNIT.exec(step)
  if (match === null) throw new RangeError(`Invalid learning step "${String(step)}"`)
  const value = Number.parseInt(match[1] as string, 10)
  switch (match[2]) {
    case 'm':
      return value
    case 'h':
      return value * 60
    default:
      return value * 1440
  }
}

function assertSteps(name: string, steps: readonly unknown[]): readonly StepUnit[] {
  if (!Array.isArray(steps)) throw new RangeError(`${name} must be an array of steps`)
  for (const step of steps) {
    if (!isStepUnit(step)) {
      throw new RangeError(`${name}: "${String(step)}" is not a step like 1m, 10m, 1h or 1d`)
    }
  }
  return steps as readonly StepUnit[]
}

/** Throws on anything `ts-fsrs` would reject or silently coerce. Returns the input. */
export function assertSchedulingOptions(options: SchedulingOptions): SchedulingOptions {
  const { desiredRetention, maxIntervalDays } = options
  if (!Number.isFinite(desiredRetention) || desiredRetention <= 0 || desiredRetention > 1) {
    throw new RangeError(`desiredRetention must be in (0, 1], got ${String(desiredRetention)}`)
  }
  if (!Number.isInteger(maxIntervalDays) || maxIntervalDays < 1) {
    throw new RangeError(`maxIntervalDays must be an integer ≥ 1, got ${String(maxIntervalDays)}`)
  }
  assertSteps('learningSteps', options.learningSteps)
  assertSteps('relearningSteps', options.relearningSteps)
  if (typeof options.fuzz !== 'boolean') {
    throw new RangeError(`fuzz must be a boolean, got ${String(options.fuzz)}`)
  }
  return options
}

/** The per-review options a parameter set implies (its retention, cap and steps). */
export function schedulingOptionsFromParameters(
  parameters: FsrsParameters,
  overrides: Partial<SchedulingOptions> = {},
): SchedulingOptions {
  return assertSchedulingOptions({
    desiredRetention: parameters.requestRetention,
    maxIntervalDays: parameters.maximumInterval,
    learningSteps: parameters.learningSteps,
    relearningSteps: parameters.relearningSteps,
    fuzz: parameters.enableFuzz,
    ...overrides,
  })
}

/** The columns of `scheduler_profiles` a stored profile contributes. */
export type SchedulerProfileParameters = Pick<
  SchedulerProfile,
  | 'w'
  | 'learningSteps'
  | 'relearningSteps'
  | 'enableFuzz'
  | 'enableShortTerm'
  | 'maximumInterval'
  | 'dayStartHour'
>

/**
 * What `createFsrsScheduler` needs from a stored profile: its parameters, the short-term
 * switch and the day-start hour. The time zone is not a profile column — it is the
 * device's — so the caller passes it (`Intl.DateTimeFormat().resolvedOptions().timeZone`
 * in the app); `UTC` when omitted.
 */
export function schedulerConfigFromProfile(
  profile: Pick<SchedulerProfileParameters, 'w' | 'enableShortTerm' | 'dayStartHour'>,
  options: { timeZone?: string } = {},
): FsrsSchedulerConfig {
  const config: FsrsSchedulerConfig = {
    w: profile.w.length === 0 ? DEFAULT_FSRS_W : assertParameters(profile.w),
    enableShortTerm: profile.enableShortTerm,
    dayStartHour: profile.dayStartHour,
  }
  if (options.timeZone !== undefined) config.timeZone = options.timeZone
  return config
}

/**
 * A stored profile as `FsrsParameters`. Profiles carry no desired retention — that is the
 * importance level's (§7) — so it is the spec's 0.9 unless overridden. The day-start hour
 * is not a parameter of the algorithm: `schedulerConfigFromProfile` carries it.
 */
export function parametersFromProfile(
  profile: SchedulerProfileParameters,
  overrides: Partial<FsrsParameters> = {},
): FsrsParameters {
  const w = profile.w.length === 0 ? DEFAULT_FSRS_W : assertParameters(profile.w)
  return {
    w,
    requestRetention: DEFAULT_FSRS_PARAMETERS.requestRetention,
    maximumInterval: profile.maximumInterval,
    learningSteps: assertSteps('learningSteps', profile.learningSteps),
    relearningSteps: assertSteps('relearningSteps', profile.relearningSteps),
    enableFuzz: profile.enableFuzz,
    enableShortTerm: profile.enableShortTerm,
    ...overrides,
  }
}
