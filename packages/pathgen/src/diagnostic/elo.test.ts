import { describe, expect, it } from 'vitest'
import {
  confidenceWeight,
  difficultyLogitOf,
  expectedCorrect,
  ITEM_K_SCALE,
  isApplyOrAbove,
  itemDifficultyAfter,
  kFactor,
  sigmoid,
  thetaDelta,
} from './elo'

describe('sigmoid() / expectedCorrect()', () => {
  it('is 0.5 at the origin', () => {
    expect(sigmoid(0)).toBe(0.5)
  })

  it('is P = σ(θ − d): higher θ than d gives P above 0.5', () => {
    expect(expectedCorrect(1, 0)).toBeGreaterThan(0.5)
    expect(expectedCorrect(0, 1)).toBeLessThan(0.5)
    expect(expectedCorrect(2, 2)).toBe(0.5)
  })
})

describe('kFactor()', () => {
  it('is 1.6 on the first item (n = 0)', () => {
    expect(kFactor(0)).toBe(1.6)
  })

  it('decays to 0.8 at n = 20 (K(n) = 1.6 / (1 + 0.05n))', () => {
    expect(kFactor(20)).toBeCloseTo(0.8, 10)
  })

  it('decays monotonically in between', () => {
    expect(kFactor(10)).toBeLessThan(kFactor(0))
    expect(kFactor(20)).toBeLessThan(kFactor(10))
  })
})

describe('confidenceWeight()', () => {
  it('weighs sure/unsure/guessed as 1 / 0.6 / 0.3', () => {
    expect(confidenceWeight('sure')).toBe(1)
    expect(confidenceWeight('unsure')).toBe(0.6)
    expect(confidenceWeight('guessed')).toBe(0.3)
  })

  it('weighs a null confidence as unsure', () => {
    expect(confidenceWeight(null)).toBe(confidenceWeight('unsure'))
  })
})

describe('thetaDelta()', () => {
  it('moves θ by exactly 0.8 on the first item, at P = 0.5, "sure"', () => {
    const delta = thetaDelta({
      theta: 0,
      difficulty: 0,
      answered: 0,
      correct: true,
      confidence: 'sure',
    })
    expect(delta).toBeCloseTo(0.8, 10)
  })

  it('scales Δθ linearly with the confidence weight', () => {
    const base = { theta: 0, difficulty: 0, answered: 0, correct: true }
    const sure = thetaDelta({ ...base, confidence: 'sure' })
    const unsure = thetaDelta({ ...base, confidence: 'unsure' })
    const guessed = thetaDelta({ ...base, confidence: 'guessed' })
    expect(unsure).toBeCloseTo(sure * 0.6, 10)
    expect(guessed).toBeCloseTo(sure * 0.3, 10)
  })

  it('weighs a null confidence exactly as "unsure"', () => {
    const base = { theta: 0.3, difficulty: -0.2, answered: 4, correct: false }
    expect(thetaDelta({ ...base, confidence: null })).toBe(
      thetaDelta({ ...base, confidence: 'unsure' }),
    )
  })

  it('decays K(n) as the module accumulates answers', () => {
    const base = { theta: 0, difficulty: 0, correct: true, confidence: 'sure' as const }
    const first = thetaDelta({ ...base, answered: 0 })
    const twentieth = thetaDelta({ ...base, answered: 20 })
    expect(twentieth).toBeCloseTo(0.4, 10)
    expect(twentieth).toBeLessThan(first)
  })

  it('gives a negative Δθ on a wrong answer', () => {
    const delta = thetaDelta({
      theta: 0,
      difficulty: 0,
      answered: 0,
      correct: false,
      confidence: 'sure',
    })
    expect(delta).toBeLessThan(0)
    expect(delta).toBeCloseTo(-0.8, 10)
  })
})

describe('itemDifficultyAfter()', () => {
  it('uses a quarter of the learner’s K scale', () => {
    expect(ITEM_K_SCALE).toBeCloseTo(0.4, 10)
  })

  it('makes an item easier (smaller d) when answered correctly better than expected', () => {
    // θ = 2, d = 0 ⇒ P ≈ 0.88, well below the "correct" outcome: the item was easier than
    // its own estimate expected.
    const after = itemDifficultyAfter({ difficulty: 0, theta: 2, correct: true, answered: 0 })
    expect(after).toBeLessThan(0)
  })

  it('makes an item harder (larger d) when missed worse than expected', () => {
    // θ = -2, d = 0 ⇒ P ≈ 0.12, well above the "wrong" outcome.
    const after = itemDifficultyAfter({ difficulty: 0, theta: -2, correct: false, answered: 0 })
    expect(after).toBeGreaterThan(0)
  })

  it('decays its own K(n) with the item’s exposure count, same shape as the learner’s', () => {
    const first = itemDifficultyAfter({ difficulty: 0, theta: 2, correct: true, answered: 0 })
    const later = itemDifficultyAfter({ difficulty: 0, theta: 2, correct: true, answered: 20 })
    // Both move the difficulty down (easier), but the later update moves it less.
    expect(Math.abs(later)).toBeLessThan(Math.abs(first))
  })
})

describe('difficultyLogitOf()', () => {
  it('maps the LLM’s 1–5 estimate onto -1.6 .. 1.6 in steps of 0.8', () => {
    expect(difficultyLogitOf(1)).toBeCloseTo(-1.6, 10)
    expect(difficultyLogitOf(2)).toBeCloseTo(-0.8, 10)
    expect(difficultyLogitOf(3)).toBeCloseTo(0, 10)
    expect(difficultyLogitOf(4)).toBeCloseTo(0.8, 10)
    expect(difficultyLogitOf(5)).toBeCloseTo(1.6, 10)
  })
})

describe('isApplyOrAbove()', () => {
  it('is false for remember and understand', () => {
    expect(isApplyOrAbove('remember')).toBe(false)
    expect(isApplyOrAbove('understand')).toBe(false)
  })

  it('is true for apply, analyze, evaluate and create', () => {
    expect(isApplyOrAbove('apply')).toBe(true)
    expect(isApplyOrAbove('analyze')).toBe(true)
    expect(isApplyOrAbove('evaluate')).toBe(true)
    expect(isApplyOrAbove('create')).toBe(true)
  })

  it('is false for a null bloom level', () => {
    expect(isApplyOrAbove(null)).toBe(false)
  })
})
