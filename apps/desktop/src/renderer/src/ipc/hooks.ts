import type {
  ChannelName,
  Contract,
  EventName,
  Events,
  InferEvent,
  InferInput,
  InferOutput,
} from '@retenia/ipc-contract'
import {
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import { useEffect } from 'react'
import { invokeIpc } from './client'

type QueryOverrides<K extends ChannelName> = Omit<
  UseQueryOptions<InferOutput<Contract, K>, Error, InferOutput<Contract, K>, unknown[]>,
  'queryKey' | 'queryFn'
>

/**
 * Read a channel through TanStack Query, keyed by channel plus input so two reads of the
 * same channel with different arguments do not share a cache entry.
 */
export function useIpcQuery<K extends ChannelName>(
  channel: K,
  input: InferInput<Contract, K>,
  options?: QueryOverrides<K>,
): UseQueryResult<InferOutput<Contract, K>, Error> {
  return useQuery({
    ...options,
    queryKey: [channel, input],
    queryFn: () => invokeIpc(channel, input),
  })
}

type MutationOverrides<K extends ChannelName> = Omit<
  UseMutationOptions<InferOutput<Contract, K>, Error, InferInput<Contract, K>>,
  'mutationKey' | 'mutationFn'
>

/** Write to a channel. Failures arrive as an `IpcError`, so `error.code` is available. */
export function useIpcMutation<K extends ChannelName>(
  channel: K,
  options?: MutationOverrides<K>,
): UseMutationResult<InferOutput<Contract, K>, Error, InferInput<Contract, K>> {
  return useMutation({
    ...options,
    mutationKey: [channel],
    mutationFn: (input: InferInput<Contract, K>) => invokeIpc(channel, input),
  })
}

/** Subscribe to a main-process push for as long as the component is mounted. */
export function useIpcEvent<K extends EventName>(
  name: K,
  listener: (payload: InferEvent<Events, K>) => void,
): void {
  useEffect(() => window.api.events.on(name, listener), [name, listener])
}
