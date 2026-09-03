import { describe, expect, it, vi } from 'vitest'
import { createDomainEventBus, noopEventPublisher } from './events'
import type { DomainEvent } from './ports/domain-events'
import { cardFixture, reviewLogFixture } from './testing/memory-fixtures'

function event(): DomainEvent {
  const card = cardFixture()
  return {
    type: 'card.reviewed',
    card,
    log: reviewLogFixture(),
    previous: {
      state: 0,
      due: card.due,
      stability: 0,
      difficulty: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      lastReview: null,
    },
    retrievabilityBefore: 0,
    options: {
      desiredRetention: 0.9,
      maxIntervalDays: 36500,
      learningSteps: ['1m', '10m'],
      relearningSteps: ['10m'],
      fuzz: true,
    },
  }
}

describe('createDomainEventBus', () => {
  it('delivers to typed and catch-all subscribers in order, until they unsubscribe', () => {
    const bus = createDomainEventBus()
    const calls: string[] = []
    const off = bus.subscribe('card.reviewed', (e) => calls.push(`typed:${e.card.id}`))
    const offAll = bus.subscribeAll((e) => calls.push(`all:${e.type}`))
    bus.publish(event())
    expect(calls).toEqual(['typed:019a0000-0000-7000-8000-00000000cccc', 'all:card.reviewed'])
    off()
    bus.publish(event())
    expect(calls).toHaveLength(3)
    offAll()
    bus.publish(event())
    expect(calls).toHaveLength(3)
    // Unsubscribing twice is harmless.
    off()
  })

  it('runs every handler even when one throws, then rethrows the first error', () => {
    const bus = createDomainEventBus()
    const second = vi.fn()
    bus.subscribe('card.reviewed', () => {
      throw new Error('first')
    })
    bus.subscribe('card.reviewed', () => {
      throw new Error('second')
    })
    bus.subscribeAll(second)
    expect(() => bus.publish(event())).toThrow('first')
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('routes handler errors to onError when one is given', () => {
    const onError = vi.fn()
    const bus = createDomainEventBus({ onError })
    bus.subscribe('card.reviewed', () => {
      throw new Error('boom')
    })
    const published = event()
    expect(() => bus.publish(published)).not.toThrow()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }), published)
  })

  it('publishes to nobody without complaint', () => {
    expect(() => createDomainEventBus().publish(event())).not.toThrow()
    expect(() => noopEventPublisher.publish(event())).not.toThrow()
  })
})
