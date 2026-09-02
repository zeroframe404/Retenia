import type { z } from 'zod'

/** One request/response channel: a zod schema for each direction of the bridge. */
export interface ChannelDefinition {
  input: z.ZodType
  output: z.ZodType
}

/** A contract is a map of `domain.action` channel names to their schemas. */
export type ContractShape = Record<string, ChannelDefinition>

/** A push-event map: event name to the zod schema of its payload. */
export type EventShape = Record<string, z.ZodType>

/**
 * Declare a contract. Identity at runtime; the `const` type parameter is the point —
 * it keeps the channel names literal so `InferInput`/`InferOutput` and the generated
 * `window.api` surface stay exact.
 */
export function defineContract<const T extends ContractShape>(shape: T): T {
  return shape
}

/** Declare the push-event map. Same trick as `defineContract`. */
export function defineEvents<const T extends EventShape>(shape: T): T {
  return shape
}

export type InferInput<C extends ContractShape, K extends keyof C> = z.infer<C[K]['input']>
export type InferOutput<C extends ContractShape, K extends keyof C> = z.infer<C[K]['output']>
export type InferEvent<E extends EventShape, K extends keyof E> = z.infer<E[K]>
