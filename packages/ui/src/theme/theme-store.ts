import { create } from 'zustand'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

/** `matchMedia` reflects the same OS color scheme Electron's `nativeTheme` does, so it is a
 * reasonable first paint before the authoritative `app.themeChanged` IPC event arrives (and
 * the only source of truth at all outside Electron, e.g. Storybook). */
function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

interface ThemeStoreState {
  /** The user's stored preference. Not necessarily what is on screen — `system` needs
   * resolving against the OS. */
  preference: ThemePreference
  /** What is actually applied to `<html data-theme>` right now. */
  resolved: ResolvedTheme
  /** Records a preference change (e.g. a Settings screen). Whoever owns theme resolution in
   * this host (main's `nativeTheme`, or a `prefers-color-scheme` listener) is expected to
   * call `setResolved` afterwards with the outcome — this store does not resolve `system`
   * itself, so it stays usable in a host with no `nativeTheme` (Storybook, tests). */
  setPreference: (preference: ThemePreference) => void
  /** Records the resolved `light`/`dark` value currently in effect. */
  setResolved: (resolved: ResolvedTheme) => void
}

/**
 * Global theme store (docs/spec/01-decisions.md §10.2 sub-phase 2.1: "a `theme` store
 * (light/dark/system) synced with `nativeTheme` through IPC"). `packages/ui` has no
 * Electron/IPC access of its own (`packages/core` is the only package that enforces zero
 * Electron deps, but `ui` still keeps to it so it stays usable in Storybook and a future
 * web/Expo client) — `apps/desktop` is what actually wires `setPreference`/`setResolved`
 * to `window.api.app.{getSettings,setTheme}` and the `app.themeChanged` event.
 */
export const useThemeStore = create<ThemeStoreState>()((set) => ({
  preference: 'system',
  resolved: systemPrefersDark() ? 'dark' : 'light',
  setPreference: (preference) => set({ preference }),
  setResolved: (resolved) => set({ resolved }),
}))
