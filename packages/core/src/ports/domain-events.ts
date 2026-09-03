import type { CardReviewedEvent } from '../memory/events'

/**
 * What the domain announces after a fact is durable. Adapters route events to the
 * renderer (`cards.changed`), to gamification, to statistics; the domain only publishes.
 */
export type DomainEvent = CardReviewedEvent

export type DomainEventType = DomainEvent['type']

export type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>

export interface DomainEventPublisher {
  publish(event: DomainEvent): void
}
