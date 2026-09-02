import { useApplyTheme, useThemeStore } from '@retenia/ui'
import { useEffect } from 'react'
import { useIpcEvent, useIpcQuery } from '../ipc/hooks'

/**
 * Wires `@retenia/ui`'s host-agnostic theme store to this app's actual source of truth:
 * `app.getSettings` for the persisted preference, `app.themeChanged` for the resolved
 * `light`/`dark` value main derives from `nativeTheme` (docs/spec/07-architecture.md §4,
 * "theme store synced with `nativeTheme` through IPC"). Mount once near the root.
 */
export function ThemeSync() {
  useApplyTheme()

  const settings = useIpcQuery('app.getSettings', undefined)
  useEffect(() => {
    if (settings.data) {
      useThemeStore.getState().setPreference(settings.data.theme)
    }
  }, [settings.data])

  useIpcEvent('app.themeChanged', ({ theme }) => {
    useThemeStore.getState().setResolved(theme)
  })

  return null
}
