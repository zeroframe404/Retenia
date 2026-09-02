import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IpcError } from './client'
import { useIpcEvent, useIpcMutation, useIpcQuery } from './hooks'

const versions = { app: '0.0.0', electron: '44.1.1', chrome: '152', node: '24' }

function stubApi(overrides: Record<string, unknown> = {}) {
  const on = vi.fn(() => vi.fn())
  const api = {
    app: {
      getVersion: vi.fn(async () => ({ ok: true, data: versions })),
      ping: vi.fn(async (input: { sentAt: string }) => ({
        ok: true,
        data: { sentAt: input.sentAt, receivedAt: '2026-09-02T00:00:01.000Z' },
      })),
      ...overrides,
    },
    events: { on },
  }
  vi.stubGlobal('api', api)
  window.api = api as unknown as typeof window.api
  return api
}

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useIpcQuery', () => {
  function Versions() {
    const query = useIpcQuery('app.getVersion', undefined)
    if (query.isPending) return <p>loading</p>
    if (query.isError) return <p>error: {query.error.message}</p>
    return <p>{query.data.electron}</p>
  }

  it('unwraps a successful envelope', async () => {
    stubApi()
    render(<Versions />, { wrapper })
    expect(await screen.findByText('44.1.1')).toBeInTheDocument()
  })

  it('surfaces a failure envelope as a query error', async () => {
    stubApi({
      getVersion: vi.fn(async () => ({
        ok: false,
        error: { code: 'HANDLER_ERROR', message: 'main exploded' },
      })),
    })

    render(<Versions />, { wrapper })

    expect(await screen.findByText(/error:/)).toHaveTextContent('main exploded')
  })

  it('keys the cache by channel and input', async () => {
    const api = stubApi()
    function Two() {
      useIpcQuery('app.getVersion', undefined)
      useIpcQuery('app.getVersion', undefined)
      return null
    }
    render(<Two />, { wrapper })
    // Same channel, same input: one request, not two.
    await waitFor(() => expect(api.app.getVersion).toHaveBeenCalledTimes(1))
  })
})

describe('useIpcMutation', () => {
  function Ping() {
    const ping = useIpcMutation('app.ping')
    return (
      <>
        <button type="button" onClick={() => ping.mutate({ sentAt: '2026-09-02T00:00:00.000Z' })}>
          ping
        </button>
        {ping.data && <p>received {ping.data.receivedAt}</p>}
        {ping.isError && <p>failed: {ping.error.message}</p>}
      </>
    )
  }

  it('sends the input and unwraps the reply', async () => {
    const api = stubApi()
    render(<Ping />, { wrapper })

    await userEvent.click(screen.getByRole('button', { name: 'ping' }))

    expect(await screen.findByText(/received/)).toHaveTextContent('2026-09-02T00:00:01.000Z')
    expect(api.app.ping).toHaveBeenCalledWith({ sentAt: '2026-09-02T00:00:00.000Z' })
  })

  it('surfaces a rejected envelope, carrying the contract error code', async () => {
    stubApi({
      ping: vi.fn(async () => ({
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'sentAt: invalid ISO datetime' },
      })),
    })

    render(<Ping />, { wrapper })
    await userEvent.click(screen.getByRole('button', { name: 'ping' }))

    expect(await screen.findByText(/failed:/)).toHaveTextContent('invalid ISO datetime')
  })
})

describe('invokeIpc', () => {
  it('reports a channel the preload never exposed', async () => {
    stubApi()
    const { invokeIpc } = await import('./client')
    await expect(invokeIpc('cards.review' as never, undefined as never)).rejects.toBeInstanceOf(
      IpcError,
    )
  })

  it('rejects a response envelope whose data does not match the output schema', async () => {
    stubApi({ getVersion: vi.fn(async () => ({ ok: true, data: { app: '0.0.0' } })) })
    const { invokeIpc } = await import('./client')
    await expect(invokeIpc('app.getVersion', undefined)).rejects.toMatchObject({
      code: 'INVALID_OUTPUT',
    })
  })
})

describe('useIpcEvent', () => {
  it('subscribes while mounted and unsubscribes on teardown', () => {
    const off = vi.fn()
    const on = vi.fn(() => off)
    vi.stubGlobal('api', { app: {}, events: { on } })
    window.api = { app: {}, events: { on } } as unknown as typeof window.api

    function Themed() {
      useIpcEvent('app.themeChanged', () => {})
      return null
    }

    const view = render(<Themed />, { wrapper })
    expect(on).toHaveBeenCalledWith('app.themeChanged', expect.any(Function))

    view.unmount()
    expect(off).toHaveBeenCalled()
  })
})
