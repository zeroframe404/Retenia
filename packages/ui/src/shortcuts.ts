export type ShortcutScope = 'global' | 'review'

export interface ShortcutDef {
  /** Stable id, `scope.action` (e.g. `review.grade1`). */
  id: string
  /** Key combo as `react-hotkeys-hook` expects it, e.g. `ctrl+k`, `shift+?`, `1`. */
  keys: string
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
    scope: 'global',
    description: 'shortcuts.openSettings',
  },
  {
    id: 'shell.shortcutsSheet',
    keys: 'shift+?',
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
]
