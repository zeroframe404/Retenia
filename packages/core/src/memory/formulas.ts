import type { Grade, MemoryState } from './types'

/**
 * FSRS-6 in closed form (`docs/spec/02-memory-system.md` §3), independent of `ts-fsrs`.
 *
 * The scheduler itself delegates to `ts-fsrs`; these exist so that exam mode, the
 * simulator and the statistics can answer "when does R fall to r?" or "does this item
 * arrive at the exam with R ≥ target?" in O(1) without instantiating a scheduler (§8).
 * `formulas.test.ts` cross-checks every one of them against `ts-fsrs` to 1e-6.
 *
 * Where `ts-fsrs` and `py-fsrs` differ, the closed forms follow `ts-fsrs` (§5): the
 * initial-stability floor is 0.1 (py-fsrs: 0.001) and the same-day increase is masked to
 * ≥ 1 for Hard as well as Good and Easy.
 */

/** `w20`, the decay of the forgetting curve (FSRS-6 default). */
export const DEFAULT_DECAY_PARAMETER = 0.1542

/** The 21 optimizable parameters `w0…w20`. */
export const PARAMETER_COUNT = 21

/** `ts-fsrs` `S_MIN`/`S_MAX`: the range every stability update is clamped to. */
export const STABILITY_MIN = 0.001
export const STABILITY_MAX = 36500

/** `ts-fsrs` floors `S0 = w[G−1]` at 0.1 (`init_stability`); py-fsrs at 0.001. */
export const INITIAL_STABILITY_MIN = 0.1

export const DIFFICULTY_MIN = 1
export const DIFFICULTY_MAX = 10

/**
 * §3.3, the clamping ranges of `w0…w20` (`ts-fsrs` `CLAMP_PARAMETERS` with the short-term
 * formulas enabled). `ts-fsrs` additionally tightens the ceiling of `w17`/`w18` when there
 * are two or more relearning steps; that is applied per instance inside the scheduler.
 */
export const PARAMETER_CLAMP_RANGES: ReadonlyArray<readonly [min: number, max: number]> =
  Object.freeze([
    [STABILITY_MIN, 100],
    [STABILITY_MIN, 100],
    [STABILITY_MIN, 100],
    [STABILITY_MIN, 100],
    [1, 10],
    [0.001, 4],
    [0.001, 4],
    [0.001, 0.75],
    [0, 4.5],
    [0, 0.8],
    [0.001, 3.5],
    [0.001, 5],
    [0.001, 0.25],
    [0.001, 0.9],
    [0, 4],
    [0, 1],
    [1, 6],
    [0, 2],
    [0, 2],
    [0.01, 0.8],
    [0.1, 0.8],
  ] as const)

/** §3.2 (i): fuzz widens with the interval — ±15 % in `[2.5, 7)`, ±10 % in `[7, 20)`,
 *  ±5 % from 20 days on. Below 2.5 days there is no fuzz at all. */
export const FUZZ_RANGES: ReadonlyArray<{ start: number; end: number; factor: number }> =
  Object.freeze([
    { start: 2.5, end: 7, factor: 0.15 },
    { start: 7, end: 20, factor: 0.1 },
    { start: 20, end: Number.POSITIVE_INFINITY, factor: 0.05 },
  ])

export interface ForgettingCurveConstants {
  /** `−w20`. */
  readonly decay: number
  /** `0.9^(1/decay) − 1`, chosen so that `R(S, S) = 0.9`. */
  readonly factor: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function assertFinite(name: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`FSRS: ${name} must be a finite number, got ${String(value)}`)
  }
}

function assertGrade(grade: number): asserts grade is Grade {
  if (grade !== 1 && grade !== 2 && grade !== 3 && grade !== 4) {
    throw new RangeError(`FSRS: grade must be 1 (Again) … 4 (Easy), got ${String(grade)}`)
  }
}

/** Throws unless `w` is 21 finite numbers. Returns it typed for indexing. */
export function assertParameters(w: readonly number[]): readonly number[] {
  if (!Array.isArray(w) || w.length !== PARAMETER_COUNT) {
    throw new RangeError(
      `FSRS: expected ${PARAMETER_COUNT} parameters (w0…w20), got ${Array.isArray(w) ? w.length : typeof w}`,
    )
  }
  for (const [index, value] of w.entries()) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new RangeError(`FSRS: w${index} must be a finite number, got ${String(value)}`)
    }
  }
  return w
}

/** Every parameter forced into its §3.3 range. Never mutates the input. */
export function clampParameters(w: readonly number[]): number[] {
  assertParameters(w)
  return PARAMETER_CLAMP_RANGES.map(([min, max], index) => clamp(w[index] as number, min, max))
}

/** The two constants of the forgetting curve for a given `w20`. */
export function decayConstants(w20: number = DEFAULT_DECAY_PARAMETER): ForgettingCurveConstants {
  assertFinite('w20', w20)
  if (w20 <= 0) throw new RangeError(`FSRS: w20 (decay) must be positive, got ${w20}`)
  const decay = -w20
  return { decay, factor: 0.9 ** (1 / decay) - 1 }
}

/**
 * §3.2 (a): `R(t, S) = (1 + factor · t / S)^decay` — the probability of recall `t` days
 * after a review that left the card at stability `S`. Guarantees `R(S, S) = 0.9`.
 *
 * `t` is clamped at 0 (a review "in the future" is a clock step, not a time machine).
 * A card with no stability yet (`S = 0`, never reviewed) has no curve: 0, as `ts-fsrs`
 * answers for a `New` card.
 */
export function forgettingCurve(
  elapsedDays: number,
  stability: number,
  w20: number = DEFAULT_DECAY_PARAMETER,
): number {
  assertFinite('elapsedDays', elapsedDays)
  assertFinite('stability', stability)
  if (stability <= 0) return 0
  const { decay, factor } = decayConstants(w20)
  const t = Math.max(0, elapsedDays)
  return (1 + (factor * t) / stability) ** decay
}

/**
 * §3.2 (b): `I(r, S) = S · (r^(1/decay) − 1) / factor`, the interval after which R falls
 * to `r`. Exactly `S` for `r = 0.9`; unrounded and uncapped — see `scheduledInterval`.
 */
export function intervalForRetention(
  retention: number,
  stability: number,
  w20: number = DEFAULT_DECAY_PARAMETER,
): number {
  assertFinite('retention', retention)
  assertFinite('stability', stability)
  if (retention <= 0 || retention > 1) {
    throw new RangeError(`FSRS: retention must be in (0, 1], got ${retention}`)
  }
  if (stability < 0) throw new RangeError(`FSRS: stability must be ≥ 0, got ${stability}`)
  const { decay, factor } = decayConstants(w20)
  // `(x / factor)` first: for r = 0.9 the quotient is exactly 1, so I(0.9, S) === S.
  return stability * ((retention ** (1 / decay) - 1) / factor)
}

/**
 * §3.2 (b), second half: the integer interval the scheduler actually books before fuzz —
 * `clamp(round(I), 1, maxIntervalDays)`, as `ts-fsrs`'s `next_interval` does it.
 */
export function scheduledInterval(
  retention: number,
  stability: number,
  maxIntervalDays: number,
  w20: number = DEFAULT_DECAY_PARAMETER,
): number {
  assertFinite('maxIntervalDays', maxIntervalDays)
  if (maxIntervalDays < 1) {
    throw new RangeError(`FSRS: maxIntervalDays must be ≥ 1, got ${maxIntervalDays}`)
  }
  const raw = intervalForRetention(retention, stability, w20)
  return Math.min(Math.max(1, Math.round(raw)), maxIntervalDays)
}

/** §3.2 (c): `S0(G) = max(w[G−1], 0.1)` — the stability after the very first rating. */
export function initialStability(w: readonly number[], grade: Grade): number {
  assertParameters(w)
  assertGrade(grade)
  return Math.max(w[grade - 1] as number, INITIAL_STABILITY_MIN)
}

/** `D0(G)` before the `[1, 10]` clamp — the mean-reversion target uses it unclamped. */
function rawInitialDifficulty(w: readonly number[], grade: Grade): number {
  return (w[4] as number) - Math.exp((w[5] as number) * (grade - 1)) + 1
}

/** §3.2 (c): `D0(G) = w4 − e^(w5·(G−1)) + 1`, clamped to `[1, 10]`. */
export function initialDifficulty(w: readonly number[], grade: Grade): number {
  assertParameters(w)
  assertGrade(grade)
  return clamp(rawInitialDifficulty(w, grade), DIFFICULTY_MIN, DIFFICULTY_MAX)
}

/**
 * §3.2 (d): `ΔD = −w6·(G−3)`, linear damping `D' = D + ΔD·(10−D)/9`, then mean reversion
 * `D'' = w7·D0(4) + (1−w7)·D'`, clamped to `[1, 10]`.
 */
export function nextDifficulty(w: readonly number[], difficulty: number, grade: Grade): number {
  assertParameters(w)
  assertGrade(grade)
  assertFinite('difficulty', difficulty)
  const delta = -(w[6] as number) * (grade - 3)
  const damped = difficulty + (delta * (10 - difficulty)) / 9
  const reverted = (w[7] as number) * rawInitialDifficulty(w, 4) + (1 - (w[7] as number)) * damped
  return clamp(reverted, DIFFICULTY_MIN, DIFFICULTY_MAX)
}

/**
 * §3.2 (e): stability after a success at least a day later —
 * `S' = S·(1 + e^w8·(11−D)·S^(−w9)·(e^(w10·(1−R)) − 1)·w15^[G=Hard]·w16^[G=Easy])`.
 */
export function nextRecallStability(
  w: readonly number[],
  difficulty: number,
  stability: number,
  retrievability: number,
  grade: Exclude<Grade, 1>,
): number {
  assertParameters(w)
  assertGrade(grade)
  if ((grade as number) === 1) {
    throw new RangeError('FSRS: Again is a lapse — use nextForgetStability')
  }
  assertFinite('difficulty', difficulty)
  assertFinite('stability', stability)
  assertFinite('retrievability', retrievability)
  const hardPenalty = grade === 2 ? (w[15] as number) : 1
  const easyBonus = grade === 4 ? (w[16] as number) : 1
  const growth =
    Math.exp(w[8] as number) *
    (11 - difficulty) *
    stability ** -(w[9] as number) *
    (Math.exp((w[10] as number) * (1 - retrievability)) - 1) *
    hardPenalty *
    easyBonus
  return clamp(stability * (1 + growth), STABILITY_MIN, STABILITY_MAX)
}

/**
 * §3.2 (f): stability after a lapse — `S'f = w11·D^(−w12)·((S+1)^w13 − 1)·e^(w14·(1−R))`,
 * never above `S / e^(w17·w18)` (or above `S` itself with the short-term formulas off), so
 * a lapse never increases stability.
 */
export function nextForgetStability(
  w: readonly number[],
  difficulty: number,
  stability: number,
  retrievability: number,
  options: { shortTerm?: boolean } = {},
): number {
  assertParameters(w)
  assertFinite('difficulty', difficulty)
  assertFinite('stability', stability)
  assertFinite('retrievability', retrievability)
  const longTerm =
    (w[11] as number) *
    difficulty ** -(w[12] as number) *
    ((stability + 1) ** (w[13] as number) - 1) *
    Math.exp((w[14] as number) * (1 - retrievability))
  const ceiling =
    options.shortTerm === false
      ? stability
      : stability / Math.exp((w[17] as number) * (w[18] as number))
  return clamp(Math.min(longTerm, ceiling), STABILITY_MIN, STABILITY_MAX)
}

/**
 * §3.2 (g): the same-day review — `SInc = S^(−w19)·e^(w17·(G−3+w18))`, masked to ≥ 1 for
 * Hard, Good and Easy (as `ts-fsrs`; py-fsrs ≤ 6.3.1 masked only Good and Easy).
 */
export function shortTermStability(w: readonly number[], stability: number, grade: Grade): number {
  assertParameters(w)
  assertGrade(grade)
  assertFinite('stability', stability)
  const increase =
    stability ** -(w[19] as number) * Math.exp((w[17] as number) * (grade - 3 + (w[18] as number)))
  const masked = grade >= 2 ? Math.max(increase, 1) : increase
  return clamp(stability * masked, STABILITY_MIN, STABILITY_MAX)
}

export interface NextStateOptions {
  /** Apply the same-day formulas when `elapsedDays` is 0 (default true, as the profile's
   *  `enable_short_term`). */
  shortTerm?: boolean
  /** `R` at review time, when the caller already has it; otherwise from the curve. */
  retrievability?: number
}

/**
 * The whole DSR transition of one review (`ts-fsrs` `next_state`): the initial state for a
 * card never rated, the same-day formulas at `t = 0`, the lapse formula for Again and the
 * recall formula otherwise. Difficulty always moves by (d).
 */
export function nextMemoryState(
  w: readonly number[],
  state: MemoryState | null,
  elapsedDays: number,
  grade: Grade,
  options: NextStateOptions = {},
): MemoryState {
  assertParameters(w)
  assertGrade(grade)
  assertFinite('elapsedDays', elapsedDays)
  if (elapsedDays < 0) throw new RangeError(`FSRS: elapsedDays must be ≥ 0, got ${elapsedDays}`)
  if (state === null || (state.stability === 0 && state.difficulty === 0)) {
    return { stability: initialStability(w, grade), difficulty: initialDifficulty(w, grade) }
  }
  const { stability, difficulty } = state
  if (difficulty < DIFFICULTY_MIN || stability < STABILITY_MIN) {
    throw new RangeError(`FSRS: invalid memory state S=${stability} D=${difficulty}`)
  }
  const shortTerm = options.shortTerm !== false
  const retrievability =
    options.retrievability ?? forgettingCurve(elapsedDays, stability, w[20] as number)
  let nextStability: number
  if (elapsedDays === 0 && shortTerm) {
    nextStability = shortTermStability(w, stability, grade)
  } else if (grade === 1) {
    nextStability = nextForgetStability(w, difficulty, stability, retrievability, { shortTerm })
  } else {
    nextStability = nextRecallStability(w, difficulty, stability, retrievability, grade)
  }
  return { stability: nextStability, difficulty: nextDifficulty(w, difficulty, grade) }
}

export interface FuzzWindow {
  /** The earliest day the fuzzed interval may land on. */
  min: number
  /** The latest. */
  max: number
}

/**
 * §3.2 (i): the `[min, max]` day window an interval may be fuzzed into (`ts-fsrs`
 * `get_fuzz_range`). `min` never lands on or before the review that just happened
 * (`≥ elapsedDays + 1`) and never below 2; `max` never exceeds `maxIntervalDays`.
 */
export function fuzzRange(
  interval: number,
  elapsedDays: number,
  maxIntervalDays: number,
): FuzzWindow {
  assertFinite('interval', interval)
  assertFinite('elapsedDays', elapsedDays)
  assertFinite('maxIntervalDays', maxIntervalDays)
  let delta = 1
  for (const range of FUZZ_RANGES) {
    delta += range.factor * Math.max(Math.min(interval, range.end) - range.start, 0)
  }
  const capped = Math.min(interval, maxIntervalDays)
  let min = Math.max(2, Math.round(capped - delta))
  const max = Math.min(Math.round(capped + delta), maxIntervalDays)
  if (capped > elapsedDays) min = Math.max(min, elapsedDays + 1)
  min = Math.min(min, max)
  return { min, max }
}
