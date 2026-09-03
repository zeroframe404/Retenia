import {
  CLAMP_PARAMETERS,
  computeDecayFactor,
  fsrs,
  get_fuzz_range,
  Rating,
  forgetting_curve as tsForgettingCurve,
} from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import {
  assertParameters,
  clampParameters,
  DEFAULT_DECAY_PARAMETER,
  decayConstants,
  forgettingCurve,
  fuzzRange,
  initialDifficulty,
  initialStability,
  intervalForRetention,
  nextDifficulty,
  nextForgetStability,
  nextMemoryState,
  nextRecallStability,
  PARAMETER_CLAMP_RANGES,
  STABILITY_MAX,
  STABILITY_MIN,
  scheduledInterval,
  shortTermStability,
} from './formulas'
import { DEFAULT_FSRS_W } from './parameters'
import { GRADES, type Grade } from './types'

/** Every formula against ts-fsrs 5.4.2 at 1e-6 (it rounds to 8 decimals; we do not). */
const TOLERANCE = 1e-6

const STABILITIES = [0.1, 0.212, 0.5, 1, 2.3065, 8.2956, 10, 31.7, 100, 1000, 36500]
const DIFFICULTIES = [1, 2.5, 4.8, 5.5, 8, 10]
const RETRIEVABILITIES = [0.2, 0.5, 0.7, 0.85, 0.9, 0.97, 1]
const ELAPSED = [0, 1, 2, 5, 13, 30, 365, 3650]

/** A second, deliberately odd parameter set inside every clamp range. */
const CUSTOM_W = [
  0.4, 1.0, 3.0, 10.0, 6.0, 0.9, 2.5, 0.01, 1.5, 0.2, 1.0, 1.2, 0.08, 0.3, 1.5, 0.5, 2.2, 0.6, 0.15,
  0.1, 0.2,
]

function expectClose(actual: number, expected: number, context: string): void {
  const error = Math.abs(actual - expected) / Math.max(1, Math.abs(expected))
  expect(error, `${context}: ${actual} vs ${expected}`).toBeLessThanOrEqual(TOLERANCE)
}

describe('forgetting curve (a)', () => {
  it('matches ts-fsrs for both parameter sets', () => {
    for (const w of [DEFAULT_FSRS_W, CUSTOM_W]) {
      for (const stability of STABILITIES) {
        for (const elapsed of ELAPSED) {
          expectClose(
            forgettingCurve(elapsed, stability, w[20]),
            tsForgettingCurve(w as number[], elapsed, stability),
            `R(${elapsed}, ${stability})`,
          )
        }
      }
    }
  })

  it('is 1 at t = 0, exactly 0.9 at t = S, and decreasing', () => {
    for (const stability of STABILITIES) {
      expect(forgettingCurve(0, stability)).toBe(1)
      expect(Math.abs(forgettingCurve(stability, stability) - 0.9)).toBeLessThan(1e-12)
      let previous = 1
      for (const elapsed of ELAPSED.slice(1)) {
        const r = forgettingCurve(elapsed, stability)
        expect(r).toBeLessThan(previous)
        expect(r).toBeGreaterThan(0)
        previous = r
      }
    }
  })

  it('is 0 without a stability and treats a negative elapsed time as 0', () => {
    expect(forgettingCurve(3, 0)).toBe(0)
    expect(forgettingCurve(3, -1)).toBe(0)
    expect(forgettingCurve(-2, 10)).toBe(1)
  })

  it('exposes the decay constants ts-fsrs derives', () => {
    const { decay, factor } = decayConstants()
    const reference = computeDecayFactor(DEFAULT_FSRS_W as number[])
    expect(decay).toBe(-DEFAULT_DECAY_PARAMETER)
    expectClose(factor, reference.factor, 'factor')
    expect(() => decayConstants(0)).toThrow(RangeError)
    expect(() => decayConstants(Number.NaN)).toThrow(RangeError)
    expect(() => forgettingCurve(Number.NaN, 1)).toThrow(RangeError)
    expect(() => forgettingCurve(1, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})

describe('interval for retention (b)', () => {
  it('returns exactly S for the default retention of 0.9', () => {
    for (const stability of [...STABILITIES, 0.001, 12345.678, Math.SQRT1_2]) {
      const interval = intervalForRetention(0.9, stability)
      expect(interval).toBe(stability)
      expect(Math.abs(interval - stability)).toBeLessThanOrEqual(1e-9 * stability)
    }
  })

  it('matches ts-fsrs’s interval modifier', () => {
    for (const w of [DEFAULT_FSRS_W, CUSTOM_W]) {
      const f = fsrs({ w: [...w] })
      for (const retention of [0.7, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97, 0.99]) {
        const modifier = f.calculate_interval_modifier(retention)
        for (const stability of STABILITIES) {
          expectClose(
            intervalForRetention(retention, stability, w[20]),
            modifier * stability,
            `I(${retention}, ${stability})`,
          )
        }
      }
    }
  })

  it('reproduces the cost table of the spec (§7): interval × S and review frequency', () => {
    const table: Array<[retention: number, interval: number, frequency: number]> = [
      [0.7, 9.29, 0.11],
      [0.8, 3.32, 0.3],
      [0.85, 1.91, 0.52],
      [0.9, 1.0, 1.0],
      [0.93, 0.61, 1.63],
      [0.95, 0.4, 2.48],
      [0.97, 0.22, 4.49],
      [0.98, 0.14, 7.0],
      [0.99, 0.07, 14.6],
    ]
    for (const [retention, interval, frequency] of table) {
      const multiplier = intervalForRetention(retention, 1)
      expect(multiplier).toBeCloseTo(interval, 2)
      expect(1 / multiplier).toBeCloseTo(frequency, frequency >= 10 ? 0 : 1)
    }
  })

  it('is monotone: a higher retention means a shorter interval, and r = 1 means now', () => {
    let previous = Number.POSITIVE_INFINITY
    for (const retention of [0.5, 0.7, 0.9, 0.95, 0.99]) {
      const interval = intervalForRetention(retention, 10)
      expect(interval).toBeLessThan(previous)
      previous = interval
    }
    expect(intervalForRetention(1, 10)).toBe(0)
    expect(intervalForRetention(0.9, 0)).toBe(0)
  })

  it('rejects impossible inputs', () => {
    expect(() => intervalForRetention(0, 10)).toThrow(RangeError)
    expect(() => intervalForRetention(1.01, 10)).toThrow(RangeError)
    expect(() => intervalForRetention(0.9, -1)).toThrow(RangeError)
    expect(() => intervalForRetention(Number.NaN, 1)).toThrow(RangeError)
    expect(() => intervalForRetention(0.9, Number.NaN)).toThrow(RangeError)
  })

  it('books the same integer interval as ts-fsrs before fuzz', () => {
    for (const w of [DEFAULT_FSRS_W, CUSTOM_W]) {
      for (const retention of [0.8, 0.9, 0.95]) {
        for (const maximum of [30, 365, 36500]) {
          const f = fsrs({ w: [...w], request_retention: retention, maximum_interval: maximum })
          for (const stability of STABILITIES) {
            expect(scheduledInterval(retention, stability, maximum, w[20])).toBe(
              f.next_interval(stability, 0),
            )
          }
        }
      }
    }
    expect(scheduledInterval(0.9, 0.2, 36500)).toBe(1)
    expect(() => scheduledInterval(0.9, 1, 0)).toThrow(RangeError)
    expect(() => scheduledInterval(0.9, 1, Number.NaN)).toThrow(RangeError)
  })
})

describe('initial state (c)', () => {
  it('matches ts-fsrs, floor included', () => {
    const low = [...DEFAULT_FSRS_W]
    low[0] = 0.05
    low[1] = 0.001
    for (const w of [DEFAULT_FSRS_W, CUSTOM_W, low]) {
      const f = fsrs({ w: [...w] })
      for (const grade of GRADES) {
        expect(initialStability(w, grade)).toBe(f.init_stability(grade))
        // ts-fsrs clamps D0 in next_state, not in init_difficulty.
        expectClose(
          initialDifficulty(w, grade),
          Math.min(10, Math.max(1, f.init_difficulty(grade))),
          `D0(${grade})`,
        )
      }
    }
    expect(initialStability(low, 1)).toBe(0.1)
    expect(initialStability(low, 2)).toBe(0.1)
    expect(initialStability(low, 3)).toBe(2.3065)
  })

  it('orders S0 by grade and keeps D0 in [1, 10]', () => {
    expect(initialStability(DEFAULT_FSRS_W, 1)).toBeLessThan(initialStability(DEFAULT_FSRS_W, 2))
    expect(initialStability(DEFAULT_FSRS_W, 2)).toBeLessThan(initialStability(DEFAULT_FSRS_W, 3))
    expect(initialStability(DEFAULT_FSRS_W, 3)).toBeLessThan(initialStability(DEFAULT_FSRS_W, 4))
    const extreme = [...DEFAULT_FSRS_W]
    extreme[4] = 10
    extreme[5] = 4
    expect(initialDifficulty(extreme, 4)).toBe(1)
    expect(initialDifficulty(extreme, 1)).toBe(10)
  })

  it('rejects a bad grade or parameter vector', () => {
    expect(() => initialStability(DEFAULT_FSRS_W, 0 as Grade)).toThrow(RangeError)
    expect(() => initialDifficulty(DEFAULT_FSRS_W, 5 as Grade)).toThrow(RangeError)
    expect(() => initialStability([1, 2, 3], 1)).toThrow(/21 parameters/)
    expect(() => assertParameters('nope' as unknown as number[])).toThrow(/21 parameters/)
    const nan = [...DEFAULT_FSRS_W]
    nan[7] = Number.NaN
    expect(() => assertParameters(nan)).toThrow(/w7/)
  })
})

describe('difficulty (d) and stability updates (e), (f), (g)', () => {
  it('match ts-fsrs over a grid', () => {
    for (const w of [DEFAULT_FSRS_W, CUSTOM_W]) {
      const f = fsrs({ w: [...w] })
      for (const difficulty of DIFFICULTIES) {
        for (const grade of GRADES) {
          expectClose(
            nextDifficulty(w, difficulty, grade),
            f.next_difficulty(difficulty, grade),
            'D',
          )
        }
        for (const stability of STABILITIES) {
          for (const grade of GRADES) {
            expectClose(
              shortTermStability(w, stability, grade),
              f.next_short_term_stability(stability, grade),
              `S same-day (${stability}, ${grade})`,
            )
          }
          for (const retrievability of RETRIEVABILITIES) {
            for (const grade of [2, 3, 4] as const) {
              expectClose(
                nextRecallStability(w, difficulty, stability, retrievability, grade),
                f.next_recall_stability(difficulty, stability, retrievability, grade),
                `S recall (${difficulty}, ${stability}, ${retrievability}, ${grade})`,
              )
            }
            // ts-fsrs applies the "never above S / e^(w17·w18)" ceiling in next_state.
            const lapse = f.next_state({ difficulty, stability }, 1, Rating.Again, retrievability)
            expectClose(
              nextForgetStability(w, difficulty, stability, retrievability),
              lapse.stability,
              `S lapse (${difficulty}, ${stability}, ${retrievability})`,
            )
          }
        }
      }
    }
  })

  it('never lets a lapse increase stability, with or without the short-term ceiling', () => {
    for (const stability of STABILITIES) {
      for (const difficulty of DIFFICULTIES) {
        expect(nextForgetStability(DEFAULT_FSRS_W, difficulty, stability, 0.5)).toBeLessThanOrEqual(
          stability,
        )
        expect(
          nextForgetStability(DEFAULT_FSRS_W, difficulty, stability, 0.5, { shortTerm: false }),
        ).toBeLessThanOrEqual(stability)
      }
    }
  })

  it('masks the same-day increase to ≥ 1 for Hard, Good and Easy but not Again', () => {
    // Large S: the raw increase is below 1 for Hard.
    expect(shortTermStability(DEFAULT_FSRS_W, 400, 2)).toBe(400)
    expect(shortTermStability(DEFAULT_FSRS_W, 400, 3)).toBeGreaterThanOrEqual(400)
    expect(shortTermStability(DEFAULT_FSRS_W, 400, 1)).toBeLessThan(400)
    // With the defaults a same-day Hard never shrinks S, and Good grows it.
    expect(shortTermStability(DEFAULT_FSRS_W, 0.5, 2)).toBeGreaterThanOrEqual(0.5)
    expect(shortTermStability(DEFAULT_FSRS_W, 0.5, 3)).toBeGreaterThan(0.5)
  })

  it('refuses Again in the recall formula and validates its numbers', () => {
    expect(() => nextRecallStability(DEFAULT_FSRS_W, 5, 5, 0.9, 1 as never)).toThrow(/lapse/)
    expect(() => nextRecallStability(DEFAULT_FSRS_W, Number.NaN, 5, 0.9, 3)).toThrow(RangeError)
    expect(() => nextForgetStability(DEFAULT_FSRS_W, 5, Number.NaN, 0.9)).toThrow(RangeError)
    expect(() => nextDifficulty(DEFAULT_FSRS_W, Number.NaN, 3)).toThrow(RangeError)
    expect(() => shortTermStability(DEFAULT_FSRS_W, Number.NaN, 3)).toThrow(RangeError)
  })

  it('clamps to [S_MIN, S_MAX] and [1, 10]', () => {
    expect(nextRecallStability(DEFAULT_FSRS_W, 1, 36500, 0.5, 4)).toBe(STABILITY_MAX)
    expect(shortTermStability(DEFAULT_FSRS_W, 36500, 4)).toBe(STABILITY_MAX)
    expect(shortTermStability(DEFAULT_FSRS_W, STABILITY_MIN, 1)).toBe(STABILITY_MIN)
    expect(nextForgetStability(DEFAULT_FSRS_W, 10, STABILITY_MIN, 1)).toBe(STABILITY_MIN)
    // Mean reversion pulls a 10 slightly below 10 with in-range parameters; only a
    // reversion target above 10 (w5 = 0, w4 > 10) reaches the ceiling.
    expect(nextDifficulty(DEFAULT_FSRS_W, 10, 1)).toBeLessThanOrEqual(10)
    expect(nextDifficulty(DEFAULT_FSRS_W, 10, 1)).toBeGreaterThan(9.9)
    const high = [...DEFAULT_FSRS_W]
    high[4] = 20
    high[5] = 0
    expect(nextDifficulty(high, 10, 3)).toBe(10)
    expect(nextDifficulty(DEFAULT_FSRS_W, 1, 4)).toBe(1)
  })
})

describe('nextMemoryState — the whole transition', () => {
  it('matches ts-fsrs next_state: initial, same-day, lapse and recall', () => {
    for (const w of [DEFAULT_FSRS_W, CUSTOM_W]) {
      const f = fsrs({ w: [...w] })
      for (const grade of GRADES) {
        const initial = nextMemoryState(w, null, 0, grade)
        const reference = f.next_state(null, 0, grade)
        expectClose(initial.stability, reference.stability, 'initial S')
        expectClose(initial.difficulty, reference.difficulty, 'initial D')
        expect(nextMemoryState(w, { stability: 0, difficulty: 0 }, 5, grade)).toEqual(initial)
        for (const stability of STABILITIES) {
          for (const difficulty of DIFFICULTIES) {
            for (const elapsed of ELAPSED) {
              const ours = nextMemoryState(w, { stability, difficulty }, elapsed, grade)
              const theirs = f.next_state({ stability, difficulty }, elapsed, grade)
              expectClose(
                ours.stability,
                theirs.stability,
                `S (${stability},${difficulty},${elapsed},${grade})`,
              )
              expectClose(
                ours.difficulty,
                theirs.difficulty,
                `D (${stability},${difficulty},${elapsed},${grade})`,
              )
            }
          }
        }
      }
    }
  })

  it('matches ts-fsrs with the short-term formulas disabled', () => {
    const f = fsrs({ w: [...DEFAULT_FSRS_W], enable_short_term: false })
    for (const grade of GRADES) {
      for (const stability of STABILITIES) {
        for (const elapsed of [0, 1, 7]) {
          const ours = nextMemoryState(
            DEFAULT_FSRS_W,
            { stability, difficulty: 5 },
            elapsed,
            grade,
            {
              shortTerm: false,
            },
          )
          const theirs = f.next_state({ stability, difficulty: 5 }, elapsed, grade)
          expectClose(
            ours.stability,
            theirs.stability,
            `S no-short-term (${stability},${elapsed},${grade})`,
          )
          expectClose(ours.difficulty, theirs.difficulty, 'D no-short-term')
        }
      }
    }
  })

  it('accepts a precomputed retrievability and rejects a broken state', () => {
    const state = { stability: 10, difficulty: 5 }
    const viaCurve = nextMemoryState(DEFAULT_FSRS_W, state, 10, 3)
    const viaR = nextMemoryState(DEFAULT_FSRS_W, state, 10, 3, {
      retrievability: forgettingCurve(10, 10),
    })
    expect(viaR).toEqual(viaCurve)
    expect(() => nextMemoryState(DEFAULT_FSRS_W, state, -1, 3)).toThrow(RangeError)
    expect(() => nextMemoryState(DEFAULT_FSRS_W, { stability: 0, difficulty: 5 }, 1, 3)).toThrow(
      /invalid memory state/,
    )
    expect(() => nextMemoryState(DEFAULT_FSRS_W, { stability: 5, difficulty: 0.5 }, 1, 3)).toThrow(
      /invalid memory state/,
    )
  })
})

describe('parameter clamping (§3.3)', () => {
  it('is ts-fsrs’s table', () => {
    expect(PARAMETER_CLAMP_RANGES.map((range) => [...range])).toEqual(CLAMP_PARAMETERS(2, true))
  })

  it('clamps each parameter into its range without mutating the input', () => {
    const wild = Array.from({ length: 21 }, (_, index) => (index % 2 === 0 ? 1e6 : -1e6))
    const copy = [...wild]
    const clamped = clampParameters(wild)
    expect(wild).toEqual(copy)
    for (const [index, [min, max]] of PARAMETER_CLAMP_RANGES.entries()) {
      expect(clamped[index]).toBe(index % 2 === 0 ? max : min)
    }
    expect(clampParameters(DEFAULT_FSRS_W)).toEqual([...DEFAULT_FSRS_W])
  })
})

describe('fuzz window (i)', () => {
  it('is ts-fsrs’s get_fuzz_range', () => {
    for (const maximum of [5, 30, 365, 36500]) {
      for (let interval = 1; interval <= 120; interval++) {
        for (const elapsed of [0, 1, 3, 10, 40, 200]) {
          const ours = fuzzRange(interval, elapsed, maximum)
          const theirs = get_fuzz_range(interval, elapsed, maximum)
          expect(ours, `fuzz(${interval}, ${elapsed}, ${maximum})`).toEqual({
            min: theirs.min_ivl,
            max: theirs.max_ivl,
          })
        }
      }
    }
  })

  it('widens with the interval and never lands before tomorrow', () => {
    expect(fuzzRange(3, 0, 36500)).toEqual({ min: 2, max: 4 })
    expect(fuzzRange(10, 0, 36500)).toEqual({ min: 8, max: 12 })
    expect(fuzzRange(100, 0, 36500)).toEqual({ min: 93, max: 107 })
    expect(fuzzRange(10, 9, 36500).min).toBe(10)
    expect(fuzzRange(10, 30, 36500)).toEqual({ min: 8, max: 12 })
    // The spread is computed on the uncapped interval, then both ends are capped.
    expect(fuzzRange(100, 0, 90)).toEqual({ min: 83, max: 90 })
    expect(() => fuzzRange(Number.NaN, 0, 1)).toThrow(RangeError)
    expect(() => fuzzRange(1, Number.NaN, 1)).toThrow(RangeError)
    expect(() => fuzzRange(1, 0, Number.NaN)).toThrow(RangeError)
  })
})
