import { describe, expect, it } from 'vitest'
import { cardFixture } from '../testing/memory-fixtures'
import { DEFAULT_IMPORTANCE_LEVELS } from './importance'
import { evaluateLeech, leechWarningThreshold } from './leech'

describe('§4 — leechWarningThreshold', () => {
  it('warns at half the threshold, rounded up, floored at 1', () => {
    expect(leechWarningThreshold(8)).toBe(4)
    expect(leechWarningThreshold(7)).toBe(4)
    expect(leechWarningThreshold(1)).toBe(1)
  })
})

describe('§4 — evaluateLeech, stages at threshold 8', () => {
  const settings = { leechThreshold: 8, leechAction: 'edit' as const }

  it('is "none" below the warning threshold', () => {
    const card = cardFixture({ lapses: 3, leech: false, suspended: false })
    const decision = evaluateLeech({ card, settings })
    expect(decision.stage).toBe('none')
  })

  it('is "warning" from half the threshold up to (not including) it', () => {
    for (const lapses of [4, 5, 6, 7]) {
      const card = cardFixture({ lapses, leech: false, suspended: false })
      expect(evaluateLeech({ card, settings }).stage).toBe('warning')
    }
  })

  it('is "leech" at and beyond the threshold', () => {
    for (const lapses of [8, 12]) {
      const card = cardFixture({ lapses, leech: false, suspended: false })
      expect(evaluateLeech({ card, settings }).stage).toBe('leech')
    }
  })
})

describe('§7 — evaluateLeech per importance level, at the threshold', () => {
  it('urgent (warn) tags but never suspends', () => {
    const settings = DEFAULT_IMPORTANCE_LEVELS.urgent
    const card = cardFixture({ lapses: settings.leechThreshold, leech: false, suspended: false })
    const decision = evaluateLeech({ card, settings })
    expect(decision.stage).toBe('leech')
    expect(decision.tag).toBe(true)
    expect(decision.suspend).toBe(false)
    expect(decision.suggestRewrite).toBe(false)
    expect(decision.offerEdit).toBe(false)
  })

  it('high (warn_rewrite) sets suggestRewrite', () => {
    const settings = DEFAULT_IMPORTANCE_LEVELS.high
    const card = cardFixture({ lapses: settings.leechThreshold, leech: false, suspended: false })
    const decision = evaluateLeech({ card, settings })
    expect(decision.stage).toBe('leech')
    expect(decision.suggestRewrite).toBe(true)
    expect(decision.suspend).toBe(false)
    expect(decision.offerEdit).toBe(false)
  })

  it('normal (edit) sets offerEdit and does not suspend', () => {
    const settings = DEFAULT_IMPORTANCE_LEVELS.normal
    const card = cardFixture({ lapses: settings.leechThreshold, leech: false, suspended: false })
    const decision = evaluateLeech({ card, settings })
    expect(decision.stage).toBe('leech')
    expect(decision.offerEdit).toBe(true)
    expect(decision.suspend).toBe(false)
    expect(decision.suggestRewrite).toBe(false)
  })

  it('maintenance (suspend) sets suspend', () => {
    const settings = DEFAULT_IMPORTANCE_LEVELS.maintenance
    const card = cardFixture({ lapses: settings.leechThreshold, leech: false, suspended: false })
    const decision = evaluateLeech({ card, settings })
    expect(decision.stage).toBe('leech')
    expect(decision.suspend).toBe(true)
    expect(decision.offerEdit).toBe(false)
    expect(decision.suggestRewrite).toBe(false)
  })

  it('paused (none) stays "none" at any lapse count', () => {
    const settings = DEFAULT_IMPORTANCE_LEVELS.paused
    for (const lapses of [0, 4, 8, 100]) {
      const card = cardFixture({ lapses, leech: false, suspended: false })
      const decision = evaluateLeech({ card, settings })
      expect(decision.stage).toBe('none')
      expect(decision.tag).toBe(false)
      expect(decision.suspend).toBe(false)
    }
  })
})

describe('§4 — evaluateLeech, already-set state', () => {
  const settings = DEFAULT_IMPORTANCE_LEVELS.maintenance

  it('tag is false when card.leech is already true', () => {
    const card = cardFixture({ lapses: settings.leechThreshold, leech: true, suspended: false })
    expect(evaluateLeech({ card, settings }).tag).toBe(false)
  })

  it('suspend is false when the card is already suspended', () => {
    const card = cardFixture({ lapses: settings.leechThreshold, leech: false, suspended: true })
    expect(evaluateLeech({ card, settings }).suspend).toBe(false)
  })
})

describe('§4 — evaluateLeech, threshold normalization', () => {
  it('floors a non-integer threshold', () => {
    const settings = { leechThreshold: 8.9, leechAction: 'edit' as const }
    const card = cardFixture({ lapses: 8, leech: false, suspended: false })
    expect(evaluateLeech({ card, settings }).threshold).toBe(8)
    expect(evaluateLeech({ card, settings }).stage).toBe('leech')
  })

  it('clamps a sub-1 threshold to 1', () => {
    const settings = { leechThreshold: 0, leechAction: 'edit' as const }
    const card = cardFixture({ lapses: 1, leech: false, suspended: false })
    const decision = evaluateLeech({ card, settings })
    expect(decision.threshold).toBe(1)
    expect(decision.stage).toBe('leech')
  })
})
