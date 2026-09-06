import type { SourceSummary } from '@retenia/ipc-contract'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import '../../i18n'

/**
 * The Library screen over a stubbed bridge (sub-phase 6.1) — the same pattern
 * `features/stats/stats-screen.test.tsx` uses: `window.api` replaced with `vi.fn`s
 * returning the envelope shape `invokeIpc` expects, everything else (TanStack Query, the
 * real i18n strings) left as-is.
 */

const SOURCE_READY = {
  id: '019213cd-0000-7000-8000-000000000001',
  kind: 'markdown' as const,
  title: 'Cell Biology.md',
  status: 'ready' as const,
  language: 'en',
  error: null,
  meta: {
    sourceDocBlobSha256: 'a'.repeat(64),
    blockCount: 2,
    assetCount: 0,
    needsOcr: false,
    ocrPages: [],
    warnings: [],
  },
  createdAt: '2026-09-02T00:00:00.000Z',
  ingestedAt: '2026-09-02T00:01:00.000Z',
  embeddingStatus: 'ready' as const,
  embeddingModelId: 'embeddinggemma-300m@768',
  embeddingError: null,
}

const SOURCE_FAILED = {
  ...SOURCE_READY,
  id: '019213cd-0000-7000-8000-000000000002',
  title: 'Clase 03.mp4',
  status: 'failed' as const,
  meta: null,
  ingestedAt: null,
  embeddingStatus: 'ready' as const,
  embeddingModelId: 'embeddinggemma-300m@768',
  embeddingError: null,
  error: 'No parser is implemented yet for source kind "video"',
}

const DOC = {
  id: 'doc-1',
  kind: 'markdown' as const,
  title: 'Cell Biology',
  language: 'en',
  sections: [{ id: 's1', title: 'Cell Biology', level: 1, blocks: ['b1'], children: [] }],
  blocks: [
    {
      id: 'b1',
      type: 'paragraph' as const,
      text: 'Cells are the basic building blocks of life.',
      locator: { anchor: '0' },
      hash: 'a'.repeat(64),
    },
  ],
  assets: [],
  meta: { warnings: [] },
}

function ok<T>(data: T) {
  return { ok: true as const, data }
}

function stubApi(sources: SourceSummary[]) {
  const listSources = vi.fn(async () => ok({ sources }))
  const getSource = vi.fn(async ({ id }: { id: string }) =>
    ok({ source: sources.find((s) => s.id === id) ?? null }),
  )
  const getSourceDoc = vi.fn(async () => ok({ doc: DOC }))
  const retrySource = vi.fn(async ({ id }: { id: string }) =>
    ok(sources.find((s) => s.id === id) ?? SOURCE_READY),
  )
  const deleteSource = vi.fn(async () => ok(undefined))
  const addSourceFromText = vi.fn(async () => ok(SOURCE_READY))

  const api = {
    library: {
      listSources,
      getSource,
      getSourceDoc,
      retrySource,
      deleteSource,
      addSourceFromText,
      addSourceFromDialog: vi.fn(async () => ok({ sources: [] })),
      addSourceFromFiles: vi.fn(async () => ok({ sources: [] })),
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

const { LibraryPage } = await import('./library-page')

describe('LibraryPage', () => {
  it('shows the empty state with nothing in the library', async () => {
    stubApi([])
    render(<LibraryPage />, { wrapper })

    expect(await screen.findByText('Tu biblioteca está vacía')).toBeInTheDocument()
  })

  it('lists sources with their status, ready and failed', async () => {
    stubApi([SOURCE_READY, SOURCE_FAILED])
    render(<LibraryPage />, { wrapper })

    expect(await screen.findByText('Cell Biology.md')).toBeInTheDocument()
    expect(screen.getByText('Clase 03.mp4')).toBeInTheDocument()
    expect(
      screen.getByText('No parser is implemented yet for source kind "video"'),
    ).toBeInTheDocument()
  })

  it('opens a source to show its section tree, and can go back', async () => {
    const user = userEvent.setup()
    stubApi([SOURCE_READY])
    render(<LibraryPage />, { wrapper })

    await user.click(await screen.findByText('Cell Biology.md'))
    expect(
      await screen.findByText('Cells are the basic building blocks of life.'),
    ).toBeInTheDocument()

    await user.click(screen.getByLabelText('Volver a la biblioteca'))
    expect(await screen.findByText('Cell Biology.md')).toBeInTheDocument()
  })

  it('retries a failed source', async () => {
    const user = userEvent.setup()
    const api = stubApi([SOURCE_FAILED])
    render(<LibraryPage />, { wrapper })

    await user.click(await screen.findByLabelText('Reintentar'))
    await waitFor(() =>
      expect(api.library.retrySource).toHaveBeenCalledExactlyOnceWith({ id: SOURCE_FAILED.id }),
    )
  })

  it('deletes a source', async () => {
    const user = userEvent.setup()
    const api = stubApi([SOURCE_READY])
    render(<LibraryPage />, { wrapper })

    await user.click(await screen.findByLabelText('Eliminar'))
    await waitFor(() =>
      expect(api.library.deleteSource).toHaveBeenCalledExactlyOnceWith({ id: SOURCE_READY.id }),
    )
  })

  it('adds pasted text as a new source', async () => {
    const user = userEvent.setup()
    const api = stubApi([])
    render(<LibraryPage />, { wrapper })

    await user.click(await screen.findByText('Pegar texto'))
    await user.type(screen.getByTestId('paste-title-input'), 'My notes')
    await user.type(screen.getByTestId('paste-text-input'), 'Some pasted text.')
    await user.click(screen.getByTestId('paste-submit'))

    await waitFor(() =>
      expect(api.library.addSourceFromText).toHaveBeenCalledExactlyOnceWith({
        text: 'Some pasted text.',
        title: 'My notes',
      }),
    )
  })
})
