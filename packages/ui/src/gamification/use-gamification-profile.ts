import { useGamificationProfileStore } from './gamification-store'

/**
 * Reads the current gamification profile (`arcade | sober`, docs/spec/08-ux.md §4 "Sober
 * mode") so components can hide themselves — a mascot, a `Celebration`, XP badges, streak
 * chrome — without each one re-deriving it from settings. `apps/desktop` syncs the store
 * from `window.api.app.getSettings()`/`app.settingsChanged`; anything mounted without that
 * sync (Storybook, tests) sees the store's `arcade` default.
 */
export function useGamificationProfile() {
  return useGamificationProfileStore((state) => state.profile)
}
