import type { BloomLevel, ConfidenceLevel } from '@retenia/core'

/**
 * Elo-lite (`docs/spec/04-path-generation.md` §10, "Elo (Pelánek 2016)"): `P = σ(θ − d)`,
 * `θ ← θ + K(n)·w·(y − P)`, with the uncertainty function `U(n) = a/(1 + b·n)`.
 *
 * §10 step 3 fixes `b = 0.05` and asks for `K` "scaled to ≈ 0.8 on the first item": at the
 * start θ sits on the item it is asked (`P = 0.5`), so a sure answer moves it by `a · 0.5`,
 * and `a = 1.6` is the scale that makes that 0.8.
 */

export const K_SCALE = 1.6
export const K_DECAY = 0.05

/** §10 step 3 — sure / unsure / guessed. */
export const CONFIDENCE_WEIGHTS: Readonly<Record<ConfidenceLevel, number>> = Object.freeze({
  sure: 1,
  unsure: 0.6,
  guessed: 0.3,
})

/**
 * The item's own Elo scale. §10: *"with a single user, item difficulty calibrates slowly:
 * accept the noise"* — a quarter of the learner's K, so one answer nudges an LLM's estimate
 * instead of overwriting it.
 */
export const ITEM_K_SCALE = K_SCALE / 4

const APPLY_OR_ABOVE: ReadonlySet<BloomLevel> = new Set(['apply', 'analyze', 'evaluate', 'create'])

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

/** `P = σ(θ − d)`: the chance of answering an item of difficulty `d` correctly. */
export function expectedCorrect(theta: number, difficulty: number): number {
  return sigmoid(theta - difficulty)
}

/** `K(n) = 1.6 / (1 + 0.05·n)`, `n` the module's answers so far. */
export function kFactor(answered: number): number {
  return K_SCALE / (1 + K_DECAY * answered)
}

/** An answer with no declared confidence weighs as "unsure" — neither trusted nor dismissed. */
export function confidenceWeight(confidence: ConfidenceLevel | null): number {
  return confidence === null ? CONFIDENCE_WEIGHTS.unsure : CONFIDENCE_WEIGHTS[confidence]
}

export interface ThetaUpdateInput {
  readonly theta: number
  readonly difficulty: number
  readonly answered: number
  readonly correct: boolean
  readonly confidence: ConfidenceLevel | null
}

/** Δθ of §10 step 3: `K(n)·w·(y − P)`. */
export function thetaDelta(input: ThetaUpdateInput): number {
  const y = input.correct ? 1 : 0
  const p = expectedCorrect(input.theta, input.difficulty)
  return kFactor(input.answered) * confidenceWeight(input.confidence) * (y - p)
}

export interface ItemUpdateInput {
  readonly difficulty: number
  readonly theta: number
  readonly correct: boolean
  /** Answers the item has had before this one (`stats.n`). */
  readonly answered: number
}

/** The item half of Elo: an item answered better than expected gets easier. */
export function itemDifficultyAfter(input: ItemUpdateInput): number {
  const y = input.correct ? 1 : 0
  const p = expectedCorrect(input.theta, input.difficulty)
  return input.difficulty - (ITEM_K_SCALE / (1 + K_DECAY * input.answered)) * (y - p)
}

/** `ItemBankItem.v1`'s prior (§8): `(difficulty − 3) · 0.8`, for the LLM's 1–5 estimate. */
export function difficultyLogitOf(difficulty: number): number {
  return (difficulty - 3) * 0.8
}

/** §10 step 6's "apply" item: the level the objective's verb reaches, apply or above. */
export function isApplyOrAbove(bloom: BloomLevel | null): boolean {
  return bloom !== null && APPLY_OR_ABOVE.has(bloom)
}
