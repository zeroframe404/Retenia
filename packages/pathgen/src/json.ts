import type { JsonObject } from '@retenia/core'

/**
 * A document as the JSON column will hold it: a round trip through `JSON.stringify`, which
 * drops `undefined` properties and turns a `Date` into its ISO string — the same shape the
 * row comes back in, so what a test compares before and after a write is the same value.
 */
export function asJson(value: object): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}
