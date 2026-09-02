import type { ContractShape, EventShape, InferEvent, InferInput, InferOutput } from './define'
import type { IpcResult } from './envelope'

/** `'app.ping'` -> `'app'` */
export type DomainOf<K extends string> = K extends `${infer D}.${string}` ? D : never

/** `'app.ping'`, `'app'` -> `'ping'` */
export type ActionOf<K extends string, D extends string> = K extends `${D}.${infer A}` ? A : never

/**
 * A channel with a `z.void()` input takes no argument at all, so `api.app.getVersion()`
 * reads the way it should rather than `api.app.getVersion(undefined)`. Matching on `void`
 * is deliberate: it is exactly what `z.void()` infers.
 */
type ChannelFn<C extends ContractShape, K extends keyof C & string> = [InferInput<C, K>] extends [
  // biome-ignore lint/suspicious/noConfusingVoidType: it is what z.void() infers; see above.
  void,
]
  ? () => Promise<IpcResult<InferOutput<C, K>>>
  : (input: InferInput<C, K>) => Promise<IpcResult<InferOutput<C, K>>>

/**
 * The `window.api` surface, derived from the contract so preload and renderer cannot
 * drift from it: `api.<domain>.<action>(input)` plus `api.events.on(name, listener)`.
 *
 * A domain named `events` would collide with the event namespace; `buildApi` rejects
 * that at runtime, and `AssertNoEventsDomain` catches it at compile time.
 */
export type ContractApi<C extends ContractShape, E extends EventShape> = {
  [D in DomainOf<keyof C & string>]: {
    [A in ActionOf<keyof C & string, D>]: ChannelFn<C, `${D}.${A}` & keyof C & string>
  }
} & {
  events: {
    on<K extends keyof E & string>(
      name: K,
      listener: (payload: InferEvent<E, K>) => void,
    ): () => void
  }
}

/** Resolves to `never` unless a contract declares a domain called `events`. */
export type AssertNoEventsDomain<C extends ContractShape> =
  'events' extends DomainOf<keyof C & string>
    ? 'a channel domain may not be named "events": it collides with api.events'
    : never
