import type { ChannelName, EventName, IpcResult, RendererApi } from '@retenia/ipc-contract'
import { channelNames, events, isEventName } from '@retenia/ipc-contract'

export interface Bridge {
  invoke(channel: ChannelName, input: unknown): Promise<IpcResult<unknown>>
  /** Subscribe to a main-process push; returns the unsubscribe. */
  subscribe(event: EventName, listener: (payload: unknown) => void): () => void
}

/**
 * Build the `window.api` object from the contract.
 *
 * Generated rather than hand-written so the exposed surface is exactly the declared
 * channels: a channel that is not in the contract has no function to call, and adding one
 * to the contract is the only way to widen what the renderer can reach.
 */
export function buildApi(bridge: Bridge): RendererApi {
  const api: Record<string, Record<string, unknown>> = {}

  for (const channel of channelNames) {
    const [domain, action] = channel.split('.')
    if (!domain || !action) {
      throw new Error(`IPC channel "${channel}" is not named domain.action`)
    }
    if (domain === 'events') {
      throw new Error(`IPC channel "${channel}" uses the reserved domain "events"`)
    }

    let namespace = api[domain]
    if (!namespace) {
      namespace = {}
      api[domain] = namespace
    }
    namespace[action] = (input: unknown) => bridge.invoke(channel, input)
  }

  api.events = {
    on(name: unknown, listener: unknown) {
      if (!isEventName(name)) {
        throw new Error(`"${String(name)}" is not a declared IPC event`)
      }
      if (typeof listener !== 'function') {
        throw new TypeError('An event listener must be a function')
      }

      const schema = events[name]
      return bridge.subscribe(name, (payload) => {
        // Main is trusted, but a payload that does not match the contract is a bug we
        // want to see here rather than as a crash inside a React component.
        const parsed = schema.safeParse(payload)
        if (!parsed.success) {
          console.error(`[ipc] dropped a malformed "${name}" event: ${parsed.error.message}`)
          return
        }
        ;(listener as (value: unknown) => void)(parsed.data)
      })
    },
  }

  return api as unknown as RendererApi
}
