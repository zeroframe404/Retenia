import type { AbortSignalLike } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { isAborted, toAbortSignal } from './abort'
import { createManualAbort } from './testing'

describe('toAbortSignal', () => {
  it('passes a real AbortSignal through unwrapped', () => {
    const controller = new AbortController()
    expect(toAbortSignal(controller.signal)).toBe(controller.signal)
  })

  it('yields undefined for the bare structural shape', () => {
    // `AbortSignalLike` has no event to subscribe to, so there is nothing to hand the SDK.
    // The caller is checked once before dispatch instead.
    expect(toAbortSignal({ aborted: false } as AbortSignalLike)).toBeUndefined()
    expect(toAbortSignal(undefined)).toBeUndefined()
  })

  it('adds no listener to a long-lived signal, however many calls share it', () => {
    // Ships even though nothing polls today, so that a future poll cannot leak silently:
    // a shared signal that gained a listener per call would grow without bound.
    const controller = new AbortController()
    const before = controller.signal
    for (let i = 0; i < 1000; i += 1) toAbortSignal(controller.signal)
    expect(controller.signal).toBe(before)
    // A no-op listener still fires exactly once, which it could not if we had attached and
    // never removed a thousand of our own.
    let fired = 0
    controller.signal.addEventListener('abort', () => {
      fired += 1
    })
    controller.abort()
    expect(fired).toBe(1)
  })
})

describe('isAborted', () => {
  it('reads either signal shape', () => {
    const manual = createManualAbort()
    expect(isAborted(manual.signal)).toBe(false)
    manual.abort()
    expect(isAborted(manual.signal)).toBe(true)

    const controller = new AbortController()
    expect(isAborted(controller.signal)).toBe(false)
    controller.abort()
    expect(isAborted(controller.signal)).toBe(true)
    expect(isAborted(undefined)).toBe(false)
  })
})
