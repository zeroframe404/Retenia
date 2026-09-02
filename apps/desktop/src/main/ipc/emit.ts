import type { EventName, Events, InferEvent } from '@retenia/ipc-contract'
import { events } from '@retenia/ipc-contract'
import type { WebContents } from 'electron'

/**
 * Push an event to a renderer, validating the payload against the contract first so a
 * malformed push is caught here rather than in the preload of every window.
 */
export function emitEvent<K extends EventName>(
  contents: WebContents,
  name: K,
  payload: InferEvent<Events, K>,
): void {
  const parsed = events[name].safeParse(payload)
  if (!parsed.success) {
    throw new Error(`Refusing to emit "${name}" with an invalid payload: ${parsed.error.message}`)
  }
  contents.send(name, parsed.data)
}
