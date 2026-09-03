import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useIpcEvent, useIpcMutation, useIpcQuery } from './hooks'

/**
 * A registered `SettingsRepository` key (`packages/core/src/ports/settings-repository.ts`),
 * read and written through the generic `settings.get`/`settings.set` channels
 * (`packages/ipc-contract/src/channels/settings.ts`).
 *
 * There is no RPC "subscribe": every window's `useSetting` for the same key stays in sync
 * because `settings.set` broadcasts `settings.changed`, which this listens for and folds
 * straight into the TanStack Query cache — so a change made from another window (or another
 * `useSetting` call in this one) shows up here without a refetch.
 *
 * `theme`/`density`/`telemetryEnabled`/`locale`/`gamification.profile`/`updateChannel` keep
 * going through the dedicated `app.*` channels instead (`apps/desktop/src/main/settings/
 * store.ts`) — they are read before this generic path exists, at very-early startup — so
 * this is for everything else in the registry (review limits, the AI budget, the provider
 * allowlist, `sync.outboxEnabled`, …).
 */
export function useSetting<T>(key: string) {
  const queryClient = useQueryClient()

  const query = useIpcQuery('settings.get', { key })
  const mutation = useIpcMutation('settings.set')

  useIpcEvent(
    'settings.changed',
    useCallback(
      (payload) => {
        if (payload.key !== key) return
        queryClient.setQueryData(['settings.get', { key }], { value: payload.value })
      },
      [key, queryClient],
    ),
  )

  return {
    value: query.data?.value as T | undefined,
    isLoading: query.isLoading,
    error: query.error,
    set: (value: T) => mutation.mutateAsync({ key, value: value as never }).then(() => undefined),
    isSaving: mutation.isPending,
  }
}
