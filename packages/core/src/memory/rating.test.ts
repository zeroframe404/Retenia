import { describe, expect, it } from 'vitest'
import type { ConfidenceLevel } from '../entities'
import {
  clampForContext,
  feedsScheduler,
  type GradeMeta,
  type GradeResult,
  RATING_RULES,
  RATING_THRESHOLDS,
  type RatingRule,
  type RatingSignals,
  type ReviewSpec,
  toRating,
} from './rating'
import { GRADES, RATING } from './types'

/**
 * `docs/spec/02-memory-system.md` §10's mapping table, row by row, plus the two invariants
 * the table states in prose ("Hard is never assigned to an incorrect answer", "Easy only
 * with strong signals") checked over every rule at once.
 */

/** The user's median for these activities: 10 s. Fast is < 6 s, slow is > 20 s. */
const MEDIAN_MS = 10_000
const PERSONAL = { medianMs: MEDIAN_MS }
const FAST_MS = 4_000
const NORMAL_MS = 9_000
const SLOW_MS = 25_000

function meta(overrides: Partial<GradeMeta> = {}): GradeMeta {
  return { timeMs: NORMAL_MS, attempts: 1, hintsUsed: 0, ...overrides }
}

function grade(score: number, correct: boolean, overrides: Partial<GradeMeta> = {}): GradeResult {
  return { score, correct, meta: meta(overrides) }
}

function spec(rule: RatingRule, overrides: Partial<ReviewSpec> = {}): ReviewSpec {
  return { eligible: true, rule, ...overrides }
}

interface Row {
  /** Which §10 row (or §3 M-* strategy) this case comes from. */
  readonly name: string
  readonly rule: RatingRule
  readonly result: GradeResult
  readonly expected: 1 | 2 | 3 | 4 | null
  readonly review?: Partial<ReviewSpec>
  readonly signals?: RatingSignals
}

/**
 * Every cell of the §10 table. The `name` of each case quotes the cell it encodes, so a
 * failure names the row of the spec that broke rather than a line number.
 */
const ROWS: readonly Row[] = [
  // --- "Flashcard / cloze (self-assessed)": the user chooses, so nothing is derived ---
  {
    name: 'self · the user chooses the button, so no rating is derived',
    rule: 'self',
    result: grade(1, true),
    expected: null,
  },

  // --- "Type the answer (fuzzy)" ---
  {
    name: 'fuzzy · similarity < 0.6 → Again',
    rule: 'fuzzy',
    result: grade(0.59, false),
    expected: RATING.Again,
  },
  {
    name: 'fuzzy · similarity exactly 0.6 → Hard (floor of the 0.6–0.85 band)',
    rule: 'fuzzy',
    result: grade(0.6, false),
    expected: RATING.Hard,
  },
  {
    name: 'fuzzy · similarity 0.84 → Hard',
    rule: 'fuzzy',
    result: grade(0.84, false),
    expected: RATING.Hard,
  },
  {
    name: 'fuzzy · similarity ≥ 0.85 but with a hint → Hard',
    rule: 'fuzzy',
    result: grade(0.99, true, { hintsUsed: 1 }),
    expected: RATING.Hard,
  },
  {
    name: 'fuzzy · similarity ≥ 0.85 → Good',
    rule: 'fuzzy',
    result: grade(0.85, true),
    expected: RATING.Good,
  },
  {
    name: 'fuzzy · similarity ≥ 0.85 and time < 0.6 × median → Easy',
    rule: 'fuzzy',
    result: grade(0.9, true, { timeMs: FAST_MS }),
    expected: RATING.Easy,
  },
  {
    name: 'fuzzy · fast but at exactly 0.6 × median is not "< 0.6 ×" → Good',
    rule: 'fuzzy',
    result: grade(0.9, true, { timeMs: MEDIAN_MS * RATING_THRESHOLDS.fastFactor }),
    expected: RATING.Good,
  },

  // --- "Multiple choice" (M-bin) ---
  {
    name: 'binary · incorrect → Again',
    rule: 'binary',
    result: grade(0, false),
    expected: RATING.Again,
  },
  {
    name: 'binary · correct on the 2nd attempt → Hard',
    rule: 'binary',
    result: grade(1, true, { attempts: 2 }),
    expected: RATING.Hard,
  },
  {
    name: 'binary · correct but time > 2 × median → Hard',
    rule: 'binary',
    result: grade(1, true, { timeMs: SLOW_MS }),
    expected: RATING.Hard,
  },
  {
    name: 'binary · correct after a hint → Hard (M-bin)',
    rule: 'binary',
    result: grade(1, true, { hintsUsed: 1 }),
    expected: RATING.Hard,
  },
  {
    name: 'binary · correct on the 1st attempt → Good',
    rule: 'binary',
    result: grade(1, true),
    expected: RATING.Good,
  },
  {
    name: 'binary · correct, fast, and declared "sure" → Easy',
    rule: 'binary',
    result: grade(1, true, { timeMs: FAST_MS, confidence: 'sure' }),
    expected: RATING.Easy,
  },
  {
    name: 'binary · correct and fast, certainty never asked → Easy (M-bin)',
    rule: 'binary',
    result: grade(1, true, { timeMs: FAST_MS }),
    expected: RATING.Easy,
  },
  {
    name: 'binary · correct and fast but declared "guessed" → Good, not Easy',
    rule: 'binary',
    result: grade(1, true, { timeMs: FAST_MS, confidence: 'guessed' }),
    expected: RATING.Good,
  },

  // --- "Order steps" ---
  {
    name: 'ordering · more than 1 pair out of order → Again',
    rule: 'ordering',
    result: grade(0.5, false),
    signals: { pairsOutOfOrder: 2 },
    expected: RATING.Again,
  },
  {
    name: 'ordering · exactly 1 pair out of order → Hard',
    rule: 'ordering',
    result: grade(0.8, false),
    signals: { pairsOutOfOrder: 1 },
    expected: RATING.Hard,
  },
  {
    name: 'ordering · no pair out of order → Good',
    rule: 'ordering',
    result: grade(1, true),
    signals: { pairsOutOfOrder: 0 },
    expected: RATING.Good,
  },
  {
    name: 'ordering · correct and fast → Easy',
    rule: 'ordering',
    result: grade(1, true, { timeMs: FAST_MS }),
    signals: { pairsOutOfOrder: 0 },
    expected: RATING.Easy,
  },
  {
    name: 'ordering · without a pair count it falls back to M-pct',
    rule: 'ordering',
    result: grade(0.6, false),
    expected: RATING.Hard,
  },

  // --- M-pct, the generic partial-credit strategy of `03-activities.md` §3 ---
  {
    name: 'partial · p < 0.5 → Again',
    rule: 'partial',
    result: grade(0.49, false),
    expected: RATING.Again,
  },
  {
    name: 'partial · p in 0.5–0.8 → Hard',
    rule: 'partial',
    result: grade(0.5, false),
    expected: RATING.Hard,
  },
  {
    name: 'partial · p in 0.8–1 → Good',
    rule: 'partial',
    result: grade(0.8, true),
    expected: RATING.Good,
  },
  {
    name: 'partial · p = 1 with a hint → Good, not Easy',
    rule: 'partial',
    result: grade(1, true, { timeMs: FAST_MS, hintsUsed: 1 }),
    expected: RATING.Good,
  },
  {
    name: 'partial · p = 1 with no hints → Easy',
    rule: 'partial',
    result: grade(1, true, { timeMs: FAST_MS }),
    expected: RATING.Easy,
  },

  // --- "Matching (n pairs)" ---
  {
    name: 'matching · < 70 % of pairs → Again',
    rule: 'matching',
    result: grade(0.69, false),
    expected: RATING.Again,
  },
  {
    name: 'matching · exactly 70 % → Hard',
    rule: 'matching',
    result: grade(0.7, false),
    expected: RATING.Hard,
  },
  {
    name: 'matching · 99 % → Hard',
    rule: 'matching',
    result: grade(0.99, false),
    expected: RATING.Hard,
  },
  {
    name: 'matching · 100 % → Good',
    rule: 'matching',
    result: grade(1, true),
    expected: RATING.Good,
  },
  {
    name: 'matching · 100 % with no previous errors and fast → Easy',
    rule: 'matching',
    result: grade(1, true, { timeMs: FAST_MS }),
    expected: RATING.Easy,
  },
  {
    name: 'matching · 100 % and fast but on the 2nd attempt → Good, not Easy',
    rule: 'matching',
    result: grade(1, true, { timeMs: FAST_MS, attempts: 2 }),
    expected: RATING.Good,
  },

  // --- "Numeric / code problem with tests" ---
  {
    name: 'objective · fails → Again',
    rule: 'objective',
    result: grade(0.4, false),
    expected: RATING.Again,
  },
  {
    name: 'objective · passes with a hint → Hard',
    rule: 'objective',
    result: grade(1, true, { hintsUsed: 1 }),
    expected: RATING.Hard,
  },
  {
    name: 'objective · passes after more than 2 attempts → Hard',
    rule: 'objective',
    result: grade(1, true, { attempts: 3 }),
    expected: RATING.Hard,
  },
  {
    name: 'objective · passes on the 2nd attempt is not "> 2 attempts" → Good',
    rule: 'objective',
    result: grade(1, true, { attempts: 2 }),
    expected: RATING.Good,
  },
  {
    name: 'objective · passes → Good',
    rule: 'objective',
    result: grade(1, true),
    expected: RATING.Good,
  },
  {
    name: 'objective · passes on the first try and fast → Easy',
    rule: 'objective',
    result: grade(1, true, { timeMs: FAST_MS }),
    expected: RATING.Easy,
  },

  // --- "Short answer with an AI rubric" (M-ai) ---
  {
    name: 'ai · rubric < 0.5 → Again',
    rule: 'ai',
    result: grade(0.49, false),
    expected: RATING.Again,
  },
  {
    name: 'ai · rubric 0.5 → Hard',
    rule: 'ai',
    result: grade(0.5, false),
    expected: RATING.Hard,
  },
  {
    name: 'ai · rubric 0.79 → Hard',
    rule: 'ai',
    result: grade(0.79, false),
    expected: RATING.Hard,
  },
  { name: 'ai · rubric 0.8 → Good', rule: 'ai', result: grade(0.8, true), expected: RATING.Good },
  { name: 'ai · rubric 0.94 → Good', rule: 'ai', result: grade(0.94, true), expected: RATING.Good },
  {
    name: 'ai · rubric ≥ 0.95 → Easy',
    rule: 'ai',
    result: grade(0.95, true),
    expected: RATING.Easy,
  },

  // --- "Pronunciation (score API)" (M-speech) ---
  {
    name: 'speech · score < 0.5 → Again',
    rule: 'speech',
    result: grade(0.49, false),
    expected: RATING.Again,
  },
  {
    name: 'speech · score 0.5 → Hard',
    rule: 'speech',
    result: grade(0.5, false),
    expected: RATING.Hard,
  },
  {
    name: 'speech · score 0.74 → Hard',
    rule: 'speech',
    result: grade(0.74, false),
    expected: RATING.Hard,
  },
  {
    name: 'speech · score ≥ 0.75 → Good',
    rule: 'speech',
    result: grade(0.75, true),
    expected: RATING.Good,
  },
  {
    name: 'speech · score ≥ 0.9 → Easy',
    rule: 'speech',
    result: grade(0.9, true),
    expected: RATING.Easy,
  },

  // --- "Mock exam": correct → Good, slow → Hard, incorrect → Again, never Easy ---
  {
    name: 'exam_sim · incorrect → Again',
    rule: 'binary',
    review: { context: 'exam_sim' },
    result: grade(0, false),
    expected: RATING.Again,
  },
  {
    name: 'exam_sim · correct → Good',
    rule: 'binary',
    review: { context: 'exam_sim' },
    result: grade(1, true),
    expected: RATING.Good,
  },
  {
    name: 'exam_sim · correct but slow → Hard',
    rule: 'binary',
    review: { context: 'exam_sim' },
    result: grade(1, true, { timeMs: SLOW_MS }),
    expected: RATING.Hard,
  },
  {
    name: 'exam_sim · a would-be Easy is capped at Good — no Easy in an exam',
    rule: 'binary',
    review: { context: 'exam_sim' },
    result: grade(1, true, { timeMs: FAST_MS, confidence: 'sure' }),
    expected: RATING.Good,
  },
  {
    name: 'exam_sim · a perfect rubric is capped at Good too',
    rule: 'ai',
    review: { context: 'exam_sim' },
    result: grade(1, true),
    expected: RATING.Good,
  },

  // --- M-none and lesson-only types ---
  {
    name: 'none · games with chance do not feed the scheduler',
    rule: 'none',
    result: grade(1, true),
    expected: null,
  },
  {
    name: 'ineligible · a lesson-only type produces no rating whatever its rule says',
    rule: 'binary',
    review: { eligible: false },
    result: grade(1, true),
    expected: null,
  },
]

describe('toRating — every row of §10’s mapping table', () => {
  it.each(ROWS)('$name', ({ rule, result, review, signals, expected }) => {
    expect(toRating(result, spec(rule, review), PERSONAL, signals)).toBe(expected)
  })

  it('covers every rating rule', () => {
    const covered = new Set(ROWS.map((row) => row.rule))
    expect([...RATING_RULES].filter((rule) => !covered.has(rule))).toEqual([])
  })

  it('covers every cell of the scale that the table can produce', () => {
    const produced = new Set(ROWS.map((row) => row.expected))
    for (const rating of GRADES) expect(produced.has(rating)).toBe(true)
    expect(produced.has(null)).toBe(true)
  })
})

/** The rules whose Hard band §10 defines by a score rather than by the grader's verdict. */
const PARTIAL_CREDIT: readonly RatingRule[] = [
  'fuzzy',
  'matching',
  'ai',
  'speech',
  'partial',
  'ordering',
]

describe('toRating — "Hard is never assigned to an incorrect answer"', () => {
  const gradedRules = RATING_RULES.filter((rule) => rule !== 'self' && rule !== 'none')

  it.each(gradedRules)('%s · a wrong answer with score 0 is Again', (rule) => {
    expect(toRating(grade(0, false), spec(rule), PERSONAL, { pairsOutOfOrder: 5 })).toBe(
      RATING.Again,
    )
  })

  it.each(gradedRules.filter((rule) => !PARTIAL_CREDIT.includes(rule)))(
    '%s · no score at all can lift an incorrect answer above Again',
    (rule) => {
      for (let score = 0; score <= 1.0001; score += 0.05) {
        const value = Math.min(1, Number(score.toFixed(4)))
        for (const timeMs of [FAST_MS, NORMAL_MS, SLOW_MS]) {
          for (const attempts of [1, 2, 3]) {
            for (const hintsUsed of [0, 1]) {
              const rating = toRating(
                grade(value, false, { timeMs, attempts, hintsUsed }),
                spec(rule),
                PERSONAL,
              )
              expect(rating).toBe(RATING.Again)
            }
          }
        }
      }
    },
  )

  it.each(PARTIAL_CREDIT)(
    '%s · an incorrect answer below the rule’s partial-credit band is Again',
    (rule) => {
      // Under every partial-credit floor in the table (the lowest is `ai`/`partial`'s 0.5,
      // the highest `matching`'s 0.7): a score of 0.4 sits below all of them.
      expect(toRating(grade(0.4, false), spec(rule), PERSONAL, { pairsOutOfOrder: 3 })).toBe(
        RATING.Again,
      )
    },
  )

  it.each(PARTIAL_CREDIT)(
    '%s · a measurement-driven rule can reach Hard on a wrong answer, but never Good',
    (rule) => {
      // A perfect score the grader nonetheless rejected: the band would say Good or Easy,
      // and Good and Easy are the two that *lengthen* the interval.
      const rating = toRating(grade(1, false, { timeMs: FAST_MS }), spec(rule), PERSONAL, {
        pairsOutOfOrder: 0,
      })
      expect(rating).toBe(RATING.Hard)
    },
  )

  it('exam_sim never turns a failure into Hard, however slow it was', () => {
    expect(
      toRating(
        grade(0, false, { timeMs: SLOW_MS }),
        spec('binary', { context: 'exam_sim' }),
        PERSONAL,
      ),
    ).toBe(RATING.Again)
  })
})

describe('toRating — "do not use Easy in an exam"', () => {
  const gradedRules = RATING_RULES.filter((rule) => rule !== 'self' && rule !== 'none')

  it.each(gradedRules)('%s · no answer under exam_sim can reach Easy', (rule) => {
    for (const score of [0.8, 0.9, 0.95, 1]) {
      for (const timeMs of [FAST_MS, NORMAL_MS, SLOW_MS]) {
        const rating = toRating(
          grade(score, true, { timeMs, confidence: 'sure' }),
          spec(rule, { context: 'exam_sim' }),
          PERSONAL,
          { pairsOutOfOrder: 0 },
        )
        expect(rating).not.toBe(RATING.Easy)
      }
    }
  })

  it('clamps a rating the user pressed themselves, and only inside an exam', () => {
    const result = grade(1, true, { timeMs: NORMAL_MS })
    expect(
      clampForContext(RATING.Easy, spec('self', { context: 'exam_sim' }), result, PERSONAL),
    ).toBe(RATING.Good)
    expect(clampForContext(RATING.Easy, spec('self'), result, PERSONAL)).toBe(RATING.Easy)
  })

  it('demotes a slow exam answer to Hard even when the user pressed Good (§9)', () => {
    const slow = grade(1, true, { timeMs: SLOW_MS })
    expect(
      clampForContext(RATING.Good, spec('self', { context: 'exam_sim' }), slow, PERSONAL),
    ).toBe(RATING.Hard)
  })

  it('leaves an Again the user pressed alone', () => {
    const result = grade(0, false, { timeMs: SLOW_MS })
    expect(
      clampForContext(RATING.Again, spec('self', { context: 'exam_sim' }), result, PERSONAL),
    ).toBe(RATING.Again)
  })
})

describe('toRating — "Easy only with strong signals"', () => {
  const easyCapable: readonly RatingRule[] = [
    'fuzzy',
    'binary',
    'partial',
    'ordering',
    'matching',
    'objective',
  ]

  it.each(easyCapable)('%s · a perfect but unhurried answer is Good, not Easy', (rule) => {
    expect(
      toRating(grade(1, true, { timeMs: NORMAL_MS }), spec(rule), PERSONAL, {
        pairsOutOfOrder: 0,
      }),
    ).toBe(RATING.Good)
  })

  it.each(easyCapable)('%s · a perfect fast answer that used a hint is not Easy', (rule) => {
    const rating = toRating(
      grade(1, true, { timeMs: FAST_MS, hintsUsed: 1 }),
      spec(rule),
      PERSONAL,
      { pairsOutOfOrder: 0 },
    )
    expect(rating).not.toBe(RATING.Easy)
  })

  it.each(easyCapable)('%s · with no personal median, speed decides nothing', (rule) => {
    expect(
      toRating(
        grade(1, true, { timeMs: 1 }),
        spec(rule),
        { medianMs: null },
        {
          pairsOutOfOrder: 0,
        },
      ),
    ).toBe(RATING.Good)
  })

  it('never grants Easy against a generated estimate — §10 says *personal* median', () => {
    // 10 s is a third of the AI's 30 s guess, but this user has no history of their own,
    // so there is nothing to have been fast against.
    const review = spec('binary', { expectedSeconds: 30 })
    expect(toRating(grade(1, true, { timeMs: 10_000 }), review, { medianMs: null })).toBe(
      RATING.Good,
    )
  })

  it('does let the estimate demote a slow answer — M-bin’s "> 2× the expected time"', () => {
    const review = spec('binary', { expectedSeconds: 30 })
    expect(toRating(grade(1, true, { timeMs: 70_000 }), review, { medianMs: null })).toBe(
      RATING.Hard,
    )
  })

  it('prefers the personal median over the generator’s estimate', () => {
    // 4 s is fast against the estimate (30 s) but ordinary against the real median (5 s).
    const review = spec('binary', { expectedSeconds: 30 })
    expect(toRating(grade(1, true, { timeMs: 4_000 }), review, { medianMs: 5_000 })).toBe(
      RATING.Good,
    )
  })

  it('does not let the estimate demote an answer the real median calls quick', () => {
    // 70 s is slow against a 30 s guess but fast against a user who takes 200 s at this.
    const review = spec('binary', { expectedSeconds: 30 })
    expect(toRating(grade(1, true, { timeMs: 70_000 }), review, { medianMs: 200_000 })).toBe(
      RATING.Easy,
    )
  })

  it('an unmeasured time is not evidence of speed', () => {
    expect(toRating(grade(1, true, { timeMs: 0 }), spec('binary'), PERSONAL)).toBe(RATING.Good)
  })

  it.each(['unsure', 'guessed'] as const)(
    'a declared "%s" blocks Easy even when the answer was clean and fast',
    (confidence: ConfidenceLevel) => {
      expect(
        toRating(grade(1, true, { timeMs: FAST_MS, confidence }), spec('binary'), PERSONAL),
      ).toBe(RATING.Good)
    },
  )
})

describe('toRating — input validation', () => {
  it.each([
    ['a score below 0', () => toRating(grade(-0.1, false), spec('ai'), PERSONAL)],
    ['a score above 1', () => toRating(grade(1.1, true), spec('ai'), PERSONAL)],
    ['a NaN score', () => toRating(grade(Number.NaN, true), spec('ai'), PERSONAL)],
    ['zero attempts', () => toRating(grade(1, true, { attempts: 0 }), spec('binary'), PERSONAL)],
    ['negative hints', () => toRating(grade(1, true, { hintsUsed: -1 }), spec('binary'), PERSONAL)],
    [
      'a negative pair count',
      () => toRating(grade(1, true), spec('ordering'), PERSONAL, { pairsOutOfOrder: -1 }),
    ],
  ])('rejects %s', (_name, call) => {
    expect(call).toThrow(RangeError)
  })

  it('does not validate what it will not read: an ineligible activity short-circuits', () => {
    expect(toRating(grade(5, true), spec('binary', { eligible: false }), PERSONAL)).toBeNull()
  })
})

describe('feedsScheduler', () => {
  it('is false for the lesson-only types and for M-none', () => {
    expect(feedsScheduler({ eligible: false, rule: 'binary' })).toBe(false)
    expect(feedsScheduler({ eligible: true, rule: 'none' })).toBe(false)
  })

  it('is true for M-self, whose rating comes from the user rather than from toRating', () => {
    expect(feedsScheduler({ eligible: true, rule: 'self' })).toBe(true)
    expect(toRating(grade(1, true), spec('self'), PERSONAL)).toBeNull()
  })

  it.each(RATING_RULES.filter((rule) => rule !== 'none'))('is true for %s', (rule) => {
    expect(feedsScheduler({ eligible: true, rule })).toBe(true)
  })
})
