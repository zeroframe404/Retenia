import type { ProviderCardDto } from '@retenia/ipc-contract'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import '../../../i18n'

function ok<T>(data: T) {
  return { ok: true as const, data }
}

const CARD: ProviderCardDto = {
  id: 'anthropic',
  kind: 'anthropic',
  label: 'Anthropic',
  models: ['claude-sonnet-5'],
  perMillionUsd: { 'claude-sonnet-5': { input: 2, output: 10 } },
  local: false,
  hasKey: true,
  keyPreview: '••••wxyz',
  baseUrl: null,
}

function stubApi(
  overrides: {
    probeProvider?: ReturnType<typeof vi.fn>
    secretsSet?: ReturnType<typeof vi.fn>
  } = {},
) {
  const setSecret = overrides.secretsSet ?? vi.fn(async () => ok({ ok: true }))
  const probeProvider =
    overrides.probeProvider ??
    vi.fn(async () => ok({ ok: true, models: ['claude-sonnet-5'], error: null, latencyMs: 120 }))
  const api = {
    secrets: { set: setSecret },
    ai: { probeProvider },
  }
  window.api = api as unknown as typeof window.api
  return { setSecret, probeProvider }
}

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const { ProviderCard } = await import('./provider-card')

describe('ProviderCard', () => {
  it('never renders the stored key as plaintext — only the masked preview', () => {
    stubApi()
    render(<ProviderCard card={CARD} onSaved={() => {}} />, { wrapper })
    expect(screen.queryByText(CARD.keyPreview as string)).not.toBeInTheDocument()
    const input = document.querySelector('input[type="password"]') as HTMLInputElement
    expect(input).toHaveAttribute('placeholder', '••••wxyz')
    expect(input.value).toBe('')
  })

  it('shows the model list once "Probar conexión" succeeds', async () => {
    const user = userEvent.setup()
    const { probeProvider } = stubApi()
    render(<ProviderCard card={CARD} onSaved={() => {}} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'Probar conexión' }))

    await waitFor(() => expect(probeProvider).toHaveBeenCalledWith({ profileId: 'anthropic' }))
    expect(await screen.findByText(/Conectado/)).toBeInTheDocument()
  })

  it('shows the classified error when the probe fails', async () => {
    const user = userEvent.setup()
    stubApi({
      probeProvider: vi.fn(async () =>
        ok({ ok: false, models: [], error: 'the provider rejected the key', latencyMs: 40 }),
      ),
    })
    render(<ProviderCard card={CARD} onSaved={() => {}} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'Probar conexión' }))

    expect(await screen.findByText('the provider rejected the key')).toBeInTheDocument()
  })
})
