import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import '../../i18n'

/**
 * Stage 8's report (sub-phase 8.4): the flagged sentences are listed, and "abrir fuente"
 * opens the reader at the cited page — over a stubbed bridge, like the other pathgen screens.
 */

const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

const PATH_VERSION_ID = '019213cd-0000-7000-8000-000000000010'
const LESSON_ID = '019213cd-0000-7000-8000-000000000020'
const SOURCE_ID = '019213cd-0000-7000-8000-00000000003a'

function ok<T>(data: T) {
  return { ok: true as const, data }
}

function stubApi() {
  const api = {
    pathgen: {
      getQaReport: vi.fn(async () =>
        ok({
          totals: { lessons: 1, reviewed: 1, flagged: 1, meanFaithfulness: 0.5 },
          lessons: [
            {
              lessonId: LESSON_ID,
              specId: 'L01',
              moduleTitle: 'Módulo 1',
              title: 'Primera lección',
              status: 'ready' as const,
              qa: {
                faithfulness: 0.5,
                pedagogyScore: 3.4,
                coverageOk: true,
                verdict: 'flagged' as const,
                reviewed: true,
                sourcesCount: 1,
                findings: 1,
              },
              gates: [{ gate: 'faithfulness' as const, outcome: 'regenerate' as const }],
              findings: [
                {
                  gate: 'faithfulness' as const,
                  kind: 'claim_unsupported',
                  blockIndex: 1,
                  sentence: 'La memoria retiene siete elementos.',
                  detail: 'la fuente dice cuatro',
                  citations: [
                    {
                      id: 'B01',
                      sourceId: SOURCE_ID,
                      locator: 'p. 8',
                      page: 8,
                      blockIds: ['b1'],
                    },
                  ],
                },
              ],
              warnings: [],
            },
          ],
        }),
      ),
    },
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

const { QaReportPage } = await import('./qa-report-page')

describe('QaReportPage', () => {
  it('lists the flagged sentence with its verdict and opens the source at the cited page', async () => {
    const user = userEvent.setup()
    navigate.mockClear()
    stubApi()
    render(<QaReportPage pathVersionId={PATH_VERSION_ID} onBack={vi.fn()} />, { wrapper })

    expect(await screen.findByText('La memoria retiene siete elementos.')).toBeInTheDocument()
    expect(screen.getByTestId('qa-report-totals')).toHaveTextContent('1 de 1')
    expect(screen.getByTestId('qa-fidelity')).toHaveTextContent('50')
    expect(screen.getByTestId('qa-status')).toHaveTextContent('Revisar')

    await user.click(screen.getByRole('button', { name: /B01/ }))
    expect(navigate).toHaveBeenCalledWith({
      to: '/library',
      search: { sourceId: SOURCE_ID, page: 8 },
    })
  })

  it('goes back through the callback', async () => {
    const user = userEvent.setup()
    stubApi()
    const onBack = vi.fn()
    render(<QaReportPage pathVersionId={PATH_VERSION_ID} onBack={onBack} />, { wrapper })
    await user.click(await screen.findByTestId('qa-report-back'))
    expect(onBack).toHaveBeenCalled()
  })
})
