import { useQueryClient } from '@tanstack/react-query'
import { useIpcMutation, useIpcQuery } from '../ipc/hooks'

const SETTINGS_QUERY_KEY = ['app.getSettings', undefined]

/** The persisted app settings (`app.getSettings`) — theme, density, gamification profile,
 * update channel, telemetry. Shared by `AppShell` (reads density/gamification) and the
 * Settings route (reads + writes both). */
export function useSettings() {
  return useIpcQuery('app.getSettings', undefined)
}

/** Every settings mutation invalidates the shared `app.getSettings` query on success, so
 * every reader (`ThemeSync`'s `preference`, the shell's density/sober-mode wiring) picks up
 * the change without a manual refetch. `app.setTheme` additionally pushes the *resolved*
 * value via the `app.themeChanged` event (main resolves `system` against `nativeTheme`) —
 * `ThemeSync` already subscribes to that separately, so `preference` (from this
 * invalidation) and `resolved` (from the event) both stay current. */
export function useSetTheme() {
  const queryClient = useQueryClient()
  return useIpcMutation('app.setTheme', {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY }),
  })
}

export function useSetDensity() {
  const queryClient = useQueryClient()
  return useIpcMutation('app.setDensity', {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY }),
  })
}

export function useSetGamificationProfile() {
  const queryClient = useQueryClient()
  return useIpcMutation('app.setGamificationProfile', {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY }),
  })
}
