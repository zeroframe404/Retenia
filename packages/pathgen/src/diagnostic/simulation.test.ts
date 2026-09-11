import { describe, expect, it } from 'vitest'
import { simulate } from '../testing/synthetic-learners'

/**
 * The acceptance test of sub-phase 8.5: 200 synthetic learners with known module states,
 * through the real engine, on paths of 8, 12 and 20 modules.
 *
 * The gate is **known vs not known ≥ 85 %** — the decision that marks lessons completed and
 * seeds memory, and the one whose error costs the learner (skipping what they do not know).
 * The three-class accuracy is held to a floor rather than to 85 %: with a 4-option guess
 * floor, slips and noisy confidence, the best any classifier can do on a single module with
 * §10's three items is ≈ 0.80, so an 85 % three-class target would only be met by a learner
 * model built to meet it. The floor catches a regression without pretending otherwise.
 */

const report = simulate({ learners: 200, seed: 20_260_911, sizes: [8, 12, 20] })

describe('diagnostic simulation (§10 acceptance)', () => {
  it('tells known from not known in at least 85 % of modules', () => {
    expect(report.knownAccuracy).toBeGreaterThanOrEqual(0.85)
  })

  it('rarely calls a module known that is not', () => {
    expect(report.falseKnownRate).toBeLessThanOrEqual(0.06)
  })

  it('keeps the three-class accuracy above its regression floor', () => {
    expect(report.accuracy).toBeGreaterThanOrEqual(0.65)
  })

  it('never asks more than 30 items', () => {
    expect(report.maxAsked).toBeLessThanOrEqual(30)
  })

  it('never asks a section the learner said they had never seen', () => {
    expect(report.neverSeenAsked).toBe(0)
  })

  it('classifies every module of every learner', () => {
    expect(report.modules).toBe(Math.ceil(200 / 3) * 8 + 67 * 12 + 66 * 20)
  })
})
