import type { Settings } from '@retenia/ipc-contract'
import { nativeTheme } from 'electron'

export type ResolvedTheme = 'light' | 'dark'

/** `nativeTheme.shouldUseDarkColors` already folds in `themeSource: 'system'`, so this is
 * the one place that turns "what source is selected" into "what color scheme is actually
 * showing" (docs/spec/08-ux.md §5). */
export function resolveTheme(): ResolvedTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

/**
 * Applies the persisted theme preference to `nativeTheme.themeSource` and keeps every
 * window's `<html data-theme>` in sync afterwards: an OS-level theme change and an
 * in-app `app.setTheme` call both end up firing `nativeTheme`'s `'updated'` event, so
 * both are handled by the same broadcast (docs/spec/07-architecture.md §4, "theme store
 * synced with `nativeTheme` through IPC").
 *
 * Returns a disposer that removes the listener (tests, window teardown).
 */
export function initThemeSync(
  initialTheme: Settings['theme'],
  onChange: (theme: ResolvedTheme) => void,
): () => void {
  nativeTheme.themeSource = initialTheme

  const listener = () => onChange(resolveTheme())
  nativeTheme.on('updated', listener)

  // Fire once immediately so the first window paints with the right theme instead of
  // waiting for the next OS/user change.
  onChange(resolveTheme())

  return () => nativeTheme.off('updated', listener)
}
