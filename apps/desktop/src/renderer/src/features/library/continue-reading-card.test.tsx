import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import '../../i18n'

const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

function ok<T>(data: T) {
  return { ok: true as const, data }
}

function stubApi(sources: unknown[]) {
  const listRecentlyOpened = vi.fn(async () => ok({ sources }))
  const api = { library: { listRecentlyOpened } }
  vi.stubGlobal('api', api)
  window.api = api as unknown as typeof window.api
  return { listRecentlyOpened }
}

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const { ContinueReadingCard } = await import('./continue-reading-card')

describe('ContinueReadingCard', () => {
  it('renders nothing when no source has ever been opened', async () => {
    stubApi([])
    render(<ContinueReadingCard />, { wrapper })

    await waitFor(() => expect(window.api.library.listRecentlyOpened).toHaveBeenCalled())
    expect(screen.queryByTestId('continue-reading-card')).not.toBeInTheDocument()
  })

  it('lists recently opened sources and navigates to the page it left off at', async () => {
    stubApi([
      {
        id: '019213cd-0000-7000-8000-000000000001',
        kind: 'pdf',
        title: 'Fisiología.pdf',
        locator: { page: 12 },
        lastOpenedAt: '2026-09-02T00:00:00.000Z',
      },
      {
        id: '019213cd-0000-7000-8000-000000000002',
        kind: 'epub',
        title: 'Bioquímica.epub',
        locator: { cfi: 'epubcfi(/6/4!/4/2/2)' },
        lastOpenedAt: '2026-09-01T00:00:00.000Z',
      },
    ])
    render(<ContinueReadingCard />, { wrapper })

    expect(await screen.findByText('Fisiología.pdf')).toBeInTheDocument()
    expect(screen.getByText('Bioquímica.epub')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('continue-reading-019213cd-0000-7000-8000-000000000001'))
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      to: '/library',
      search: { sourceId: '019213cd-0000-7000-8000-000000000001', page: 12 },
    })

    fireEvent.click(screen.getByTestId('continue-reading-019213cd-0000-7000-8000-000000000002'))
    expect(navigate).toHaveBeenCalledWith({
      to: '/library',
      search: {
        sourceId: '019213cd-0000-7000-8000-000000000002',
        cfi: 'epubcfi(/6/4!/4/2/2)',
      },
    })
  })
})
