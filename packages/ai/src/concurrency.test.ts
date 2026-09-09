import { describe, expect, it } from 'vitest'
import { withConcurrencyLimit } from './concurrency'
import type { InvokeOutcome, InvokeTarget, ProviderInvoker } from './invoker'
import { ZERO_USAGE } from './pricing'
import type { TextGenerationRequest } from './text-generator'

const TARGET: InvokeTarget = {
  profile: {
    id: 'anthropic',
    kind: 'anthropic',
    keyRef: 'anthropic',
    caps: { jsonStrict: true },
    models: ['claude-sonnet-5'],
  },
  modelId: 'claude-sonnet-5',
  apiKey: 'k',
}
const REQUEST: TextGenerationRequest = { prompt: 'hi', temperature: 0 }
const OK: InvokeOutcome = {
  kind: 'ok',
  text: 'hi',
  modelId: 'claude-sonnet-5',
  usage: ZERO_USAGE,
  finishReason: 'stop',
}

/** Resolves only when told to, so a test can hold several calls open at once. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('withConcurrencyLimit()', () => {
  it('never runs more than `concurrency` calls at once', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const gates = Array.from({ length: 5 }, () => deferred<InvokeOutcome>())

    let call = 0
    const invoker: ProviderInvoker = async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      const outcome = await gates[call++]?.promise
      inFlight -= 1
      return outcome ?? OK
    }

    const limited = withConcurrencyLimit(invoker, 2)
    const results = Promise.all(gates.map(() => limited(TARGET, REQUEST, { signal: undefined })))

    // Let every call that is going to start this tick actually start.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(maxInFlight).toBe(2)

    for (const gate of gates) gate.resolve(OK)
    await results
    expect(maxInFlight).toBe(2)
  })

  it('still returns each call its own outcome, in order', async () => {
    const invoker: ProviderInvoker = async (_target, request) => ({
      ...OK,
      text: request.prompt,
    })
    const limited = withConcurrencyLimit(invoker, 1)

    const results = await Promise.all([
      limited(TARGET, { ...REQUEST, prompt: 'a' }, { signal: undefined }),
      limited(TARGET, { ...REQUEST, prompt: 'b' }, { signal: undefined }),
    ])

    expect(results.map((r) => (r.kind === 'ok' ? r.text : undefined))).toEqual(['a', 'b'])
  })

  it('defaults to a concurrency of 4', async () => {
    let maxInFlight = 0
    let inFlight = 0
    const invoker: ProviderInvoker = async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return OK
    }

    const limited = withConcurrencyLimit(invoker)
    await Promise.all(
      Array.from({ length: 8 }, () => limited(TARGET, REQUEST, { signal: undefined })),
    )

    expect(maxInFlight).toBeLessThanOrEqual(4)
  })
})
