import { defineContract, type IpcResult } from '@retenia/ipc-contract'
import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { registerHandlers } = await import('./register-handlers')

const testContract = defineContract({
  'demo.echo': {
    input: z.object({ value: z.string() }),
    output: z.object({ value: z.string() }),
  },
})

type Invoke = (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>

/** A stand-in for `ipcMain` that records what got registered and lets us call it. */
function makeIpc() {
  const registered = new Map<string, Invoke>()
  return {
    registered,
    handle(
      channel: string,
      listener: (event: IpcMainInvokeEvent, ...args: never[]) => Promise<unknown>,
    ) {
      registered.set(channel, listener as Invoke)
    },
    call(channel: string, input: unknown, event = {} as IpcMainInvokeEvent) {
      const listener = registered.get(channel)
      if (!listener) {
        throw new Error(`"${channel}" was never registered`)
      }
      return listener(event, input) as Promise<IpcResult<unknown>>
    },
  }
}

const logger = { error: vi.fn() }

beforeEach(() => {
  logger.error.mockClear()
})

function register(handler: (input: { value: string }) => unknown, allowSender = true) {
  const ipc = makeIpc()
  registerHandlers(
    testContract,
    { 'demo.echo': handler as never },
    { ipc, logger, isAllowedSender: () => allowSender },
  )
  return ipc
}

describe('registerHandlers', () => {
  it('returns the handler result in a success envelope', async () => {
    const ipc = register(({ value }) => ({ value: value.toUpperCase() }))
    await expect(ipc.call('demo.echo', { value: 'hi' })).resolves.toEqual({
      ok: true,
      data: { value: 'HI' },
    })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('awaits an async handler', async () => {
    const ipc = register(async ({ value }) => ({ value }))
    await expect(ipc.call('demo.echo', { value: 'hi' })).resolves.toEqual({
      ok: true,
      data: { value: 'hi' },
    })
  })

  it.each([
    ['a wrong field type', { value: 42 }],
    ['a missing field', {}],
    ['a non-object', 'nope'],
    ['nothing at all', undefined],
  ])('rejects %s as INVALID_INPUT without calling the handler', async (_label, input) => {
    const handler = vi.fn()
    const ipc = register(handler)

    const result = (await ipc.call('demo.echo', input)) as { ok: false; error: { code: string } }

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('INVALID_INPUT')
    expect(handler).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledOnce()
  })

  it('rejects a sender that is not the application renderer', async () => {
    const handler = vi.fn()
    const ipc = register(handler, false)

    const result = (await ipc.call('demo.echo', { value: 'hi' })) as {
      ok: false
      error: { code: string }
    }

    expect(result).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN_SENDER', message: expect.any(String) },
    })
    // The origin check runs before validation, so a hostile frame never reaches a schema.
    expect(handler).not.toHaveBeenCalled()
  })

  it('turns a thrown handler into HANDLER_ERROR and leaks no stack', async () => {
    const ipc = register(() => {
      throw new Error('database is on fire')
    })

    const result = (await ipc.call('demo.echo', { value: 'hi' })) as {
      ok: false
      error: { code: string; message: string }
    }

    expect(result.error.code).toBe('HANDLER_ERROR')
    expect(result.error.message).toBe('database is on fire')
    expect(JSON.stringify(result)).not.toContain('register-handlers')
    expect(Object.keys(result.error).sort()).toEqual(['code', 'message'])
  })

  it('catches a rejected promise too', async () => {
    const ipc = register(() => Promise.reject(new Error('nope')))
    const result = (await ipc.call('demo.echo', { value: 'hi' })) as {
      ok: false
      error: { code: string }
    }
    expect(result.error.code).toBe('HANDLER_ERROR')
  })

  it('flags a handler that returns the wrong shape as INVALID_OUTPUT', async () => {
    const ipc = register(() => ({ value: 42 }))
    const result = (await ipc.call('demo.echo', { value: 'hi' })) as {
      ok: false
      error: { code: string }
    }
    expect(result.error.code).toBe('INVALID_OUTPUT')
  })

  it('never rejects, so the renderer always gets a typed code', async () => {
    const ipc = register(() => {
      throw new Error('boom')
    })
    await expect(ipc.call('demo.echo', { value: 'hi' })).resolves.toBeDefined()
  })
})

describe('a channel that is not in the contract', () => {
  it('is never registered on ipcMain', () => {
    const ipc = register(({ value }) => ({ value }))
    expect([...ipc.registered.keys()]).toEqual(['demo.echo'])
    expect(ipc.registered.has('demo.somethingElse')).toBe(false)
  })

  it('cannot be called, because nothing is listening', () => {
    const ipc = register(({ value }) => ({ value }))
    expect(() => ipc.call('demo.somethingElse', {})).toThrow(/never registered/)
  })

  it('is refused at registration time', () => {
    expect(() =>
      registerHandlers(
        testContract,
        { 'demo.echo': (i: { value: string }) => i, 'demo.rogue': () => ({}) } as never,
        { ipc: makeIpc(), logger, isAllowedSender: () => true },
      ),
    ).toThrow(/"demo.rogue".*not in the IPC contract/)
  })

  it('refuses a contract channel left without a handler', () => {
    expect(() =>
      registerHandlers(testContract, {} as never, {
        ipc: makeIpc(),
        logger,
        isAllowedSender: () => true,
      }),
    ).toThrow(/Missing handler for IPC channel "demo.echo"/)
  })
})
