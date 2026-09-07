import type { SearchHit, SourceSummary } from '@retenia/ipc-contract'
import { Toaster } from '@retenia/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../../i18n'
import { SearchScreen } from './search-screen'

/**
 * The search screen over a stubbed bridge (sub-phase 6.3) — same pattern as
 * `features/library/library-page.test.tsx`: `window.api` replaced with `vi.fn`s returning the
 * envelope shape `invokeIpc` expects, the real i18n strings and TanStack Query left as-is.
 */

const SOURCE: SourceSummary = {
  id: '019213cd-0000-7000-8000-000000000001',
  kind: 'pdf',
  title: 'Fisiología.pdf',
  status: 'ready',
  language: 'es',
  error: null,
  meta: null,
  blobSha256: 'b'.repeat(64),
  embeddingStatus: 'ready',
  embeddingModelId: 'embeddinggemma-300m@768',
  embeddingError: null,
  createdAt: '2026-09-02T00:00:00.000Z',
  ingestedAt: '2026-09-02T00:01:00.000Z',
}

const OTHER_SOURCE: SourceSummary = {
  ...SOURCE,
  id: '019213cd-0000-7000-8000-000000000002',
  kind: 'epub',
  title: 'Bioquímica.epub',
  // Never embedded: it still answers full-text queries, and the panel says so.
  embeddingStatus: 'pending',
  embeddingModelId: null,
}

const HIT: SearchHit = {
  chunkId: '019213cd-0000-7000-8000-0000000000a1',
  sourceId: SOURCE.id,
  sourceTitle: SOURCE.title,
  sourceKind: 'pdf',
  score: 0.9,
  fusionScore: 0.03,
  snippet: 'El <b>corazón</b> bombea sangre por el sistema circulatorio.',
  highlighted: true,
  headingPath: 'Fisiología > Capítulo 3 > 3.2',
  label: 'p. 112',
  page: 112,
  tStartMs: null,
  blockIds: ['b1', 'b2'],
  matchedFts: true,
  matchedVector: true,
}

function ok<T>(data: T) {
  return { ok: true as const, data }
}

interface StubOptions {
  hits?: SearchHit[]
  degraded?: boolean
  modelId?: string | null
  pendingSources?: number
  createCardFails?: boolean
}

function stubApi(options: StubOptions = {}) {
  const search = vi.fn(async () =>
    ok({
      hits: options.hits ?? [HIT],
      modelId: options.modelId === undefined ? 'embeddinggemma-300m@768' : options.modelId,
      degraded: options.degraded ?? false,
      tookMs: 42,
    }),
  )
  const createCardFromChunk = vi.fn(async () =>
    options.createCardFails === true
      ? { ok: false as const, error: { code: 'internal', message: 'la base está cerrada' } }
      : // Real UUIDv7s: the renderer's IPC client validates every response against the
        // contract, and `library.createCardFromChunk` declares `z.uuid()` on both.
        ok({
          itemId: '019213cd-0000-7000-8000-0000000000b1',
          cardId: '019213cd-0000-7000-8000-0000000000b2',
        }),
  )
  const api = {
    library: {
      listSources: vi.fn(async () => ok({ sources: [SOURCE, OTHER_SOURCE] })),
      retrievalStatus: vi.fn(async () =>
        ok({
          modelId: options.modelId === undefined ? 'embeddinggemma-300m@768' : options.modelId,
          pendingSources: options.pendingSources ?? 0,
          rerankerEnabled: false,
        }),
      ),
      search,
      createCardFromChunk,
    },
    events: { on: vi.fn(() => vi.fn()) },
  }
  vi.stubGlobal('api', api)
  window.api = api as unknown as typeof window.api
  return { search, createCardFromChunk }
}

function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      {children}
      {/* The screen reports "card created" and "the reader is not built yet" as toasts, and
          `<Toaster />` lives in the root route in the real app. */}
      <Toaster />
    </QueryClientProvider>
  )
}

function renderScreen(query = 'corazón', onQueryChange = vi.fn()) {
  return render(<SearchScreen query={query} onQueryChange={onQueryChange} />, { wrapper })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('the search screen', () => {
  it('shows the passage, its source, the heading path and the page', async () => {
    stubApi()
    renderScreen()

    const hit = await screen.findByTestId('search-hit')
    expect(within(hit).getByText('Fisiología.pdf')).toBeInTheDocument()
    expect(within(hit).getByText('Fisiología > Capítulo 3 > 3.2')).toBeInTheDocument()
    expect(within(hit).getByText('p. 112')).toBeInTheDocument()
  })

  it('renders the FTS highlight as a mark, not as raw markup', async () => {
    stubApi()
    renderScreen()

    const hit = await screen.findByTestId('search-hit')
    const mark = within(hit).getByText('corazón')
    expect(mark.tagName).toBe('MARK')
    // The rest of the passage is there, and none of the markers survived as text.
    expect(hit.textContent).toContain('bombea sangre por el sistema circulatorio.')
    expect(hit.textContent).not.toContain('<b>')
  })

  it('never renders chunk text as HTML', async () => {
    // The passage is content of a file the user imported. A book about HTML contains
    // `<script>`, and it has to read as `<script>`.
    stubApi({
      hits: [{ ...HIT, snippet: 'usa <script>alert(1)</script> acá', highlighted: false }],
    })
    const { container } = renderScreen()

    await screen.findByTestId('search-hit')
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByTestId('search-hit').textContent).toContain('<script>alert(1)</script>')
  })

  it('says which branch found each hit', async () => {
    stubApi({ hits: [{ ...HIT, matchedVector: false }] })
    renderScreen()

    const hit = await screen.findByTestId('search-hit')
    expect(within(hit).getByText('texto')).toBeInTheDocument()
    expect(within(hit).queryByText('significado')).not.toBeInTheDocument()
  })

  it('discloses when the vector branch could not run', async () => {
    stubApi({ degraded: true })
    renderScreen()
    expect(await screen.findByTestId('search-degraded')).toHaveTextContent('Solo texto')
  })

  it('says so when no embedding model is configured', async () => {
    stubApi({ modelId: null, degraded: true })
    renderScreen()
    await waitFor(() =>
      expect(screen.getByTestId('search-status')).toHaveTextContent(/No hay modelo/),
    )
  })

  it('reports how many sources are still outside the index', async () => {
    stubApi({ pendingSources: 3 })
    renderScreen()
    await waitFor(() =>
      expect(screen.getByTestId('search-status')).toHaveTextContent(/3 fuentes sin indexar/),
    )
  })

  it('asks main for nothing at all while the query is empty', async () => {
    const { search } = stubApi()
    renderScreen('')
    expect(await screen.findByTestId('search-idle')).toBeInTheDocument()
    expect(search).not.toHaveBeenCalled()
  })

  it('sends the source filter the user ticked', async () => {
    const { search } = stubApi()
    const user = userEvent.setup()
    renderScreen()
    await screen.findByTestId('search-hit')

    await user.click(screen.getByRole('checkbox', { name: /Bioquímica/ }))
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(
        expect.objectContaining({ sourceIds: [OTHER_SOURCE.id] }),
      ),
    )
  })

  it('sends the type filter the user ticked', async () => {
    const { search } = stubApi()
    const user = userEvent.setup()
    renderScreen()
    await screen.findByTestId('search-hit')

    await user.click(screen.getByRole('button', { name: 'epub' }))
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ kinds: ['epub'] })),
    )
  })

  it('sends the retrieval mode the user chose', async () => {
    const { search } = stubApi()
    const user = userEvent.setup()
    renderScreen()
    await screen.findByTestId('search-hit')

    await user.click(screen.getByRole('radio', { name: 'Texto' }))
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'fts' })),
    )
  })

  it('creates a card from a fragment, and says so', async () => {
    const { createCardFromChunk } = stubApi()
    const user = userEvent.setup()
    renderScreen()

    const hit = await screen.findByTestId('search-hit')
    await user.click(within(hit).getByRole('button', { name: 'Crear tarjeta' }))

    await waitFor(() => expect(createCardFromChunk).toHaveBeenCalledWith({ chunkId: HIT.chunkId }))
    expect(await screen.findByText(/Tarjeta creada/)).toBeInTheDocument()
  })

  it('surfaces a failure to create the card rather than swallowing it', async () => {
    stubApi({ createCardFails: true })
    const user = userEvent.setup()
    renderScreen()

    const hit = await screen.findByTestId('search-hit')
    await user.click(within(hit).getByRole('button', { name: 'Crear tarjeta' }))
    expect(await screen.findByText(/la base está cerrada/)).toBeInTheDocument()
  })

  it('says the reader is not built yet rather than leaving a dead button', async () => {
    stubApi()
    const user = userEvent.setup()
    renderScreen()

    const hit = await screen.findByTestId('search-hit')
    await user.click(within(hit).getByRole('button', { name: 'Abrir en la fuente' }))
    expect(await screen.findByText(/todavía no está disponible/)).toBeInTheDocument()
  })

  it('shows an empty state when nothing matched', async () => {
    stubApi({ hits: [] })
    renderScreen()
    expect(await screen.findByTestId('search-empty')).toBeInTheDocument()
  })
})
