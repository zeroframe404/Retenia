import { expect, type Mock } from 'vitest'
import type { ActivityCompletion } from '../host/use-activity-machine'

/**
 * The first `ActivityCompletion` an `onComplete` spy received, asserting there was one.
 *
 * Reading `mock.calls[0]?.[0] as ActivityCompletion` inline is both unsafe (the cast hides a spy
 * that was never called, turning a missing completion into a confusing `undefined.result`) and
 * repeated in every host test; this fails on the spot with the real reason instead.
 */
export function completionOf(onComplete: Mock): ActivityCompletion {
  expect(onComplete).toHaveBeenCalled()
  const [completion] = onComplete.mock.calls[0] ?? []
  return completion as ActivityCompletion
}
