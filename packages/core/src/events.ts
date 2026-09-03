import type {
  DomainEvent,
  DomainEventOf,
  DomainEventPublisher,
  DomainEventType,
} from './ports/domain-events'

/**
 * A synchronous in-process event bus — the default `DomainEventPublisher`.
 *
 * Delivery is synchronous and in subscription order. A subscriber that throws does not
 * stop the others: every handler runs, then the first error is handed to `onError`
 * (rethrown by default, so a bug is loud in tests and logged by the app, which passes its
 * logger in).
 */

export type DomainEventHandler<T extends DomainEventType> = (event: DomainEventOf<T>) => void

export interface DomainEventBus extends DomainEventPublisher {
  /** Returns the unsubscribe function. */
  subscribe<T extends DomainEventType>(type: T, handler: DomainEventHandler<T>): () => void
  /** Every event, whatever its type. */
  subscribeAll(handler: (event: DomainEvent) => void): () => void
}

export interface DomainEventBusOptions {
  onError?: (error: unknown, event: DomainEvent) => void
}

/** Swallows every event — for callers that have nothing to notify. */
export const noopEventPublisher: DomainEventPublisher = Object.freeze({
  publish: () => {},
})

export function createDomainEventBus(options: DomainEventBusOptions = {}): DomainEventBus {
  const byType = new Map<DomainEventType, Set<(event: DomainEvent) => void>>()
  const all = new Set<(event: DomainEvent) => void>()
  const onError =
    options.onError ??
    ((error: unknown) => {
      throw error
    })

  const add = (
    set: Set<(event: DomainEvent) => void>,
    handler: (event: DomainEvent) => void,
  ): (() => void) => {
    set.add(handler)
    return () => {
      set.delete(handler)
    }
  }

  return {
    publish: (event) => {
      const handlers = [...(byType.get(event.type) ?? []), ...all]
      let failure: { error: unknown } | undefined
      for (const handler of handlers) {
        try {
          handler(event)
        } catch (error) {
          failure ??= { error }
        }
      }
      if (failure !== undefined) onError(failure.error, event)
    },
    subscribe: (type, handler) => {
      let set = byType.get(type)
      if (set === undefined) {
        set = new Set()
        byType.set(type, set)
      }
      return add(set, handler as (event: DomainEvent) => void)
    },
    subscribeAll: (handler) => add(all, handler),
  }
}
