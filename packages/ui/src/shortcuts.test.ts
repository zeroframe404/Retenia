import { describe, expect, it } from 'vitest'
import { SHORTCUTS } from './shortcuts'

describe('SHORTCUTS', () => {
  it('has no duplicate ids', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has no duplicate key combos within the same scope', () => {
    for (const scope of ['global', 'review'] as const) {
      const keys = SHORTCUTS.filter((s) => s.scope === scope).map((s) => s.keys)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('reserves the exact set the shell requires', () => {
    const ids = SHORTCUTS.map((s) => s.id).sort()
    expect(ids).toEqual(
      [
        'review.back',
        'review.continue',
        'review.grade1',
        'review.grade2',
        'review.grade3',
        'review.grade4',
        'review.reveal',
        'shell.commandPalette',
        'shell.openSettings',
        'shell.shortcutsSheet',
      ].sort(),
    )
  })
})
