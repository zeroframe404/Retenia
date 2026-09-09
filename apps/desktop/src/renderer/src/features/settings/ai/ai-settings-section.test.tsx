import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import '../../../i18n'

function ok<T>(data: T) {
  return { ok: true as const, data }
}

function stubApi(over: { cards?: unknown[]; hasKey?: boolean } = {}) {
  const cards = over.cards ?? [
    {
      id: 'anthropic',
      kind: 'anthropic',
      label: 'Anthropic',
      models: ['claude-sonnet-5'],
      perMillionUsd: { 'claude-sonnet-5': { input: 2, output: 10 } },
      local: false,
      hasKey: over.hasKey ?? false,
      keyPreview: null,
      baseUrl: null,
    },
  ]

  const usageSummary = {
    month: '2026-09',
    totalUsd: 4.2,
    byPurpose: [{ purpose: 'contextualize', provider: 'google', costUsd: 4.2, calls: 12 }],
    byModel: [{ provider: 'google', model: 'gemini-3.7-flash', costUsd: 4.2 }],
  }
  const exportUsageCsv = vi.fn(async () =>
    ok({ savedTo: '/home/ana/retenia-ai-usage-2026-09.csv' }),
  )

  const api = {
    ai: {
      listProviderCards: vi.fn(async () => ok({ cards })),
      getRoles: vi.fn(async () => ok({ roles: [] })),
      getPricingOverlay: vi.fn(async () =>
        ok({ revision: '2026-09-01', isOverridden: false, rows: [] }),
      ),
      getUsageSummary: vi.fn(async () => ok(usageSummary)),
      listRecentCalls: vi.fn(async () => ok({ calls: [] })),
      exportUsageCsv,
      probeProvider: vi.fn(async () => ok({ ok: true, models: [], error: null, latencyMs: 1 })),
      setRoles: vi.fn(async () => ok({ ok: true })),
      setPricingOverlay: vi.fn(async () => ok({ ok: true })),
      restorePricing: vi.fn(async () => ok({ ok: true })),
    },
    secrets: {
      get: vi.fn(async () => ok({ hasSecret: false, preview: null })),
      set: vi.fn(async () => ok({ ok: true })),
    },
    settings: {
      get: vi.fn(async ({ key }: { key: string }) => {
        const defaults: Record<string, unknown> = {
          'ai.budget.monthlyUsd': 30,
          'ai.budget.hardBlock': true,
          'ai.providers.allowlist': [],
        }
        return ok({ value: defaults[key] })
      }),
      set: vi.fn(async ({ value }: { key: string; value: unknown }) => ok({ value })),
    },
    events: { on: () => () => {} },
  }
  window.api = api as unknown as typeof window.api
  return { exportUsageCsv }
}

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const { AiSettingsSection } = await import('./ai-settings-section')

describe('AiSettingsSection', () => {
  it('shows the "Probar sin IA" notice when no provider has a key', async () => {
    stubApi({ hasKey: false })
    render(<AiSettingsSection />, { wrapper })

    expect(
      await screen.findByText(
        'Todavía no hay ningún proveedor de IA configurado. Agregá una clave abajo para usar las funciones de IA.',
      ),
    ).toBeInTheDocument()
  })

  it('hides the notice once a provider has a key configured', async () => {
    stubApi({ hasKey: true })
    render(<AiSettingsSection />, { wrapper })

    await waitFor(() => expect(window.api.ai.listProviderCards).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        screen.queryByText(
          'Todavía no hay ningún proveedor de IA configurado. Agregá una clave abajo para usar las funciones de IA.',
        ),
      ).not.toBeInTheDocument(),
    )
  })

  it("matches the usage dashboard's total to what the summary answers", async () => {
    stubApi()
    render(<AiSettingsSection />, { wrapper })

    expect(await screen.findByText('Total: USD 4.20')).toBeInTheDocument()
  })

  it('the "Exportar CSV" button calls ai.exportUsageCsv for the current month', async () => {
    const user = userEvent.setup()
    const { exportUsageCsv } = stubApi()
    render(<AiSettingsSection />, { wrapper })

    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    await user.click(await screen.findByRole('button', { name: 'Exportar CSV' }))

    await waitFor(() => expect(exportUsageCsv).toHaveBeenCalledWith({ month }))
  })
})
