import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import '../../i18n'

/**
 * The wizard's step-1 template and its live estimate (`docs/spec/04-path-generation.md` §13
 * step 1) — over a stubbed bridge, the same pattern `library-page.test.tsx` uses.
 */

const SOURCE_READY = {
  id: '019213cd-0000-7000-8000-000000000001',
  kind: 'markdown' as const,
  title: 'Física I.md',
  status: 'ready' as const,
  language: 'es',
  error: null,
  meta: null,
  blobSha256: 'b'.repeat(64),
  createdAt: '2026-09-02T00:00:00.000Z',
  ingestedAt: '2026-09-02T00:01:00.000Z',
  embeddingStatus: 'ready' as const,
  embeddingModelId: 'embeddinggemma-300m@768',
  embeddingError: null,
}

const ESTIMATE = {
  chunks: 10,
  concepts: 12,
  modules: 2,
  p1: {
    calls: 10,
    inputTokens: 1000,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 500,
    usd: 0.1,
  },
  p2Outline: {
    calls: 1,
    inputTokens: 500,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 200,
    usd: 0.05,
  },
  p2Modules: {
    calls: 2,
    inputTokens: 800,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 400,
    usd: 0.08,
  },
  usd: 0.23,
  lowUsd: 0.2,
  highUsd: 0.3,
  minutes: { low: 3, high: 6 },
  dispatch: 'sync' as const,
  priced: { cheap: true, smart: true },
}

function ok<T>(data: T) {
  return { ok: true as const, data }
}

function stubApi(options: { sources?: (typeof SOURCE_READY)[] } = {}) {
  const sources = options.sources ?? [SOURCE_READY]
  const listSources = vi.fn(async () => ok({ sources }))
  const quote = vi.fn(async () => ok({ estimate: ESTIMATE, warnings: [] }))
  const start = vi.fn(async () =>
    ok({
      runId: '019213cd-0000-7000-8000-000000000099',
      pathId: '019213cd-0000-7000-8000-000000000098',
      pathVersionId: '019213cd-0000-7000-8000-000000000097',
      status: 'completed' as const,
      warnings: [],
      draft: null,
      error: null,
    }),
  )
  const cancel = vi.fn(async () => ok({ run: null }))

  const api = {
    library: { listSources },
    pathgen: { quote, start, cancel },
    events: { on: vi.fn(() => vi.fn()) },
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

const { WizardPage } = await import('./wizard-page')

describe('WizardPage', () => {
  it('shows an empty state with no ready sources', async () => {
    stubApi({ sources: [] })
    render(<WizardPage onGenerated={vi.fn()} />, { wrapper })

    expect(await screen.findByText('Todavía no hay fuentes listas')).toBeInTheDocument()
  })

  it('quotes the live estimate once the form is filled', async () => {
    const user = userEvent.setup()
    const api = stubApi()
    render(<WizardPage onGenerated={vi.fn()} />, { wrapper })

    await user.type(await screen.findByTestId('wizard-goal'), 'Aprobar el parcial')
    await user.type(screen.getByTestId('wizard-level'), 'principiante')
    await user.selectOptions(screen.getByTestId('wizard-primary-source'), SOURCE_READY.id)

    await waitFor(() => expect(api.pathgen.quote).toHaveBeenCalled(), { timeout: 2000 })
    expect(await screen.findByTestId('wizard-estimate')).toBeInTheDocument()
  })

  it('starts a generation and reports the frozen-eligible result', async () => {
    const user = userEvent.setup()
    const api = stubApi()
    const onGenerated = vi.fn()
    render(<WizardPage onGenerated={onGenerated} />, { wrapper })

    await user.type(await screen.findByTestId('wizard-goal'), 'Aprobar el parcial')
    await user.type(screen.getByTestId('wizard-level'), 'principiante')
    await user.selectOptions(screen.getByTestId('wizard-primary-source'), SOURCE_READY.id)
    await user.click(screen.getByTestId('wizard-generate'))

    await waitFor(() =>
      expect(api.pathgen.start).toHaveBeenCalledExactlyOnceWith({
        config: expect.objectContaining({
          goal: 'Aprobar el parcial',
          level: 'principiante',
          primarySourceId: SOURCE_READY.id,
          sourceIds: [SOURCE_READY.id],
        }),
      }),
    )
    await waitFor(() =>
      expect(onGenerated).toHaveBeenCalledWith({
        runId: '019213cd-0000-7000-8000-000000000099',
        pathVersionId: '019213cd-0000-7000-8000-000000000097',
      }),
    )
  })
})
