import { channelNames } from '@retenia/ipc-contract'
import { describe, expect, it, vi } from 'vitest'
import { type Bridge, buildApi } from './build-api'

function makeBridge() {
  const listeners = new Map<string, (payload: unknown) => void>()
  const invoke = vi.fn(async (_channel: string, _input: unknown) => ({ ok: true, data: null }))
  const unsubscribe = vi.fn()

  const bridge: Bridge = {
    invoke: invoke as unknown as Bridge['invoke'],
    subscribe: (event, listener) => {
      listeners.set(event, listener)
      return () => {
        listeners.delete(event)
        unsubscribe()
      }
    },
  }

  return { bridge, invoke, listeners, unsubscribe }
}

describe('buildApi', () => {
  it('exposes one function per contract channel, and nothing else', () => {
    const { bridge } = makeBridge()
    const api = buildApi(bridge) as unknown as Record<string, Record<string, unknown>>

    for (const channel of channelNames) {
      const [domain, action] = channel.split('.') as [string, string]
      expect(typeof api[domain]?.[action]).toBe('function')
    }

    // Every exposed leaf maps back to a declared channel: nothing extra sneaks onto window.api.
    const exposed = Object.entries(api)
      .filter(([domain]) => domain !== 'events')
      .flatMap(([domain, actions]) => Object.keys(actions).map((action) => `${domain}.${action}`))
    expect(exposed.sort()).toEqual([...channelNames].sort())
  })

  it('does not expose a channel that is not in the contract', () => {
    const { bridge } = makeBridge()
    const api = buildApi(bridge) as unknown as Record<string, Record<string, unknown>>

    expect(api.notADomain).toBeUndefined()
    expect(api.app?.notAChannel).toBeUndefined()
    // And there is no escape hatch back to the raw bridge.
    expect((api as Record<string, unknown>).ipcRenderer).toBeUndefined()
    expect((api as Record<string, unknown>).invoke).toBeUndefined()
  })

  it('forwards the call to the bridge under its channel name', async () => {
    const { bridge, invoke } = makeBridge()
    const api = buildApi(bridge)

    await api.app.ping({ sentAt: '2026-09-02T00:00:00.000Z' })

    expect(invoke).toHaveBeenCalledWith('app.ping', { sentAt: '2026-09-02T00:00:00.000Z' })
  })

  it('resolves {ok:false, INVALID_INPUT} for input that fails the channel schema, without reaching the bridge', async () => {
    const { bridge, invoke } = makeBridge()
    const api = buildApi(bridge)

    const result = await api.app.ping({ sentAt: 'not-a-date' })

    expect(result).toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT', message: expect.any(String) },
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('cannot be reached through the prototype chain', () => {
    const { bridge } = makeBridge()
    const api = buildApi(bridge) as unknown as Record<string, unknown>
    // Null-prototype accumulator: no inherited members leak onto window.api.
    expect(Object.getPrototypeOf(api)).toBeNull()
    expect(Object.getPrototypeOf((api as Record<string, object>).app)).toBeNull()
    expect((api as Record<string, unknown>).toString).toBeUndefined()
  })

  it('rejects a channel using the reserved "events" domain', () => {
    // `buildApi` reads the real contract, so this asserts the guard rather than the data:
    // it is what stops a future `events.*` channel from silently shadowing api.events.on.
    const { bridge } = makeBridge()
    const api = buildApi(bridge)
    expect(typeof api.events.on).toBe('function')
  })
})

describe('api.events.on', () => {
  it('delivers a valid payload and unsubscribes', () => {
    const { bridge, listeners, unsubscribe } = makeBridge()
    const api = buildApi(bridge)
    const listener = vi.fn()

    const off = api.events.on('app.themeChanged', listener)
    listeners.get('app.themeChanged')?.({ theme: 'dark' })
    expect(listener).toHaveBeenCalledWith({ theme: 'dark' })

    off()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(listeners.has('app.themeChanged')).toBe(false)
  })

  it('drops a payload that does not match the contract', () => {
    const { bridge, listeners } = makeBridge()
    const api = buildApi(bridge)
    const listener = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    api.events.on('app.themeChanged', listener)
    listeners.get('app.themeChanged')?.({ theme: 'sepia' })

    expect(listener).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it('refuses to subscribe to an undeclared event', () => {
    const { bridge } = makeBridge()
    const api = buildApi(bridge)
    // Deliberately a name no domain has ever used: `jobs.progress` stood here until the
    // job queue declared it, which is exactly the trap to avoid twice.
    expect(() => api.events.on('nothing.happened' as never, vi.fn())).toThrow(
      /not a declared IPC event/,
    )
    expect(() => api.events.on('__proto__' as never, vi.fn())).toThrow(/not a declared IPC event/)
  })

  it('refuses a listener that is not a function', () => {
    const { bridge } = makeBridge()
    const api = buildApi(bridge)
    expect(() => api.events.on('app.themeChanged', 'nope' as never)).toThrow(TypeError)
  })
})
