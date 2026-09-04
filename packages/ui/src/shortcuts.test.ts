import { describe, expect, it } from 'vitest'
import { SHORTCUTS } from './shortcuts'

describe('SHORTCUTS', () => {
  it('has no duplicate ids', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has no duplicate key combos within the same scope (registration combo, not display)', () => {
    for (const scope of ['global', 'review'] as const) {
      const keys = SHORTCUTS.filter((s) => s.scope === scope).map((s) => s.matchKeys ?? s.keys)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('only sets matchKeys where the display combo would not match its own KeyboardEvent.code', () => {
    // react-hotkeys-hook matches by code by default; letters/digits/space/enter/esc resolve
    // the same way via either name, so only punctuation display symbols need an override.
    for (const shortcut of SHORTCUTS) {
      if (shortcut.matchKeys) {
        expect(shortcut.matchKeys).not.toBe(shortcut.keys)
      }
    }
  })

  it('reserves the exact set the shell requires', () => {
    const ids = SHORTCUTS.map((s) => s.id).sort()
    expect(ids).toEqual(
      [
        'review.back',
        'review.continue',
        'review.explain',
        'review.grade1',
        'review.grade2',
        'review.grade3',
        'review.grade4',
        'review.reveal',
        'review.skip',
        'review.undo',
        'shell.commandPalette',
        'shell.openSettings',
        'shell.shortcutsSheet',
      ].sort(),
    )
  })
})
