export type ShortcutScope = 'global' | 'review'

export interface ShortcutDef {
  /** Stable id, `scope.action` (e.g. `review.grade1`). */
  id: string
  /** Human-readable key combo, shown as-is in the shortcuts sheet (e.g. `ctrl+k`, `shift+?`). */
  keys: string
  /**
   * The actual combo to hand `react-hotkeys-hook`'s `useHotkeys`, only when it differs from
   * `keys` — the library matches `KeyboardEvent.code` by default, and a couple of displayed
   * symbols don't equal their own code name (`,` is physically the "Comma" key, `?` is
   * "Slash" held with Shift). Omitted when `keys` already matches directly (letters, digits,
   * space/enter/esc all resolve the same way via either name).
   */
  matchKeys?: string
  scope: ShortcutScope
  /**
   * i18n key, relative to the `shell` namespace's `shortcuts.*` block (see
   * `packages/i18n/src/{es-AR,en}/shell.json`) — resolved by whoever renders the shortcut
   * (e.g. `ShortcutsSheet`'s `translate` prop), never translated inside this package.
   */
  description: string
}

/**
 * The reserved keyboard shortcuts (`docs/spec/08-ux.md` §1 "keyboard first" +
 * sub-phase 2.2's task list). Central registry: both the global hotkey registration in
 * `apps/desktop` and the `ShortcutsSheet` below read from this single source, so the two
 * can never drift apart.
 */
export const SHORTCUTS: ShortcutDef[] = [
  {
    id: 'shell.commandPalette',
    keys: 'ctrl+k',
    scope: 'global',
    description: 'shortcuts.commandPalette',
  },
  {
    id: 'shell.openSettings',
    keys: 'ctrl+,',
    matchKeys: 'ctrl+comma',
    scope: 'global',
    description: 'shortcuts.openSettings',
  },
  {
    id: 'shell.shortcutsSheet',
    keys: 'shift+?',
    matchKeys: 'shift+slash',
    scope: 'global',
    description: 'shortcuts.shortcutsSheet',
  },
  { id: 'review.reveal', keys: 'space', scope: 'review', description: 'shortcuts.reveal' },
  { id: 'review.continue', keys: 'enter', scope: 'review', description: 'shortcuts.continue' },
  { id: 'review.back', keys: 'esc', scope: 'review', description: 'shortcuts.back' },
  { id: 'review.grade1', keys: '1', scope: 'review', description: 'shortcuts.grade1' },
  { id: 'review.grade2', keys: '2', scope: 'review', description: 'shortcuts.grade2' },
  { id: 'review.grade3', keys: '3', scope: 'review', description: 'shortcuts.grade3' },
  { id: 'review.grade4', keys: '4', scope: 'review', description: 'shortcuts.grade4' },
  { id: 'review.skip', keys: 's', scope: 'review', description: 'shortcuts.skip' },
  { id: 'review.explain', keys: 'e', scope: 'review', description: 'shortcuts.explain' },
  {
    id: 'review.undo',
    keys: 'ctrl+z',
    scope: 'review',
    description: 'shortcuts.undo',
  },
]
