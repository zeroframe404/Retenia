import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import '../../i18n'

/**
 * Stage 7's panel (`docs/spec/04-path-generation.md` §13 step 5) over a stubbed bridge: the
 * three per-lesson controls have to *do* something. "Reportar error" in particular shipped as
 * a button wired to an optional callback nobody passed, so it rendered, enabled, and did
 * nothing at all when clicked.
 */

const PATH_VERSION_ID = '019213cd-0000-7000-8000-000000000010'
const LESSON_ID = '019213cd-0000-7000-8000-000000000020'

function ok<T>(data: T) {
  return { ok: true as const, data }
}

function lessonRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LESSON_ID,
    specId: 'L01',
    moduleTitle: 'Módulo 1',
    title: 'Primera lección',
    status: 'ready' as const,
    activities: 5,
    flashcards: 4,
    unmet: [],
    warnings: [],
    firstCitation: {
      sourceId: '019213cd-0000-7000-8000-00000000003a',
      locator: 'p. 8',
      page: 8,
      blockIds: ['b1', 'b2'],
    },
    ...overrides,
  }
}

function stubApi(lessons: ReturnType<typeof lessonRow>[]) {
  const getLessons = vi.fn(async () => ok({ lessons }))
  const expand = vi.fn(async () => ok({ runId: 'run-1', status: 'completed' }))
  const regenerateLesson = vi.fn(async () => ok({ runId: 'run-1', status: 'completed' }))

  const api = {
    pathgen: { getLessons, expand, regenerateLesson },
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

const { ExpansionPanel } = await import('./expansion-panel')

describe('ExpansionPanel', () => {
  it('sends "Reportar error" to the cited source, at the page the citation resolved to', async () => {
    const user = userEvent.setup()
    stubApi([lessonRow()])
    const onOpenSource = vi.fn()
    render(<ExpansionPanel pathVersionId={PATH_VERSION_ID} onOpenSource={onOpenSource} />, {
      wrapper,
    })

    await user.click(await screen.findByRole('button', { name: 'Reportar error' }))

    // The page is the half that makes it a deep link rather than "open the book"; the block
    // ids are what a future in-reader highlight needs, and dropping them here would mean
    // re-resolving the citation to get them back.
    expect(onOpenSource).toHaveBeenCalledWith({
      sourceId: '019213cd-0000-7000-8000-00000000003a',
      locator: 'p. 8',
      page: 8,
      blockIds: ['b1', 'b2'],
    })
  })

  it('leaves "Reportar error" disabled when the lesson cites nothing', async () => {
    stubApi([lessonRow({ firstCitation: null })])
    render(<ExpansionPanel pathVersionId={PATH_VERSION_ID} onOpenSource={vi.fn()} />, { wrapper })

    expect(await screen.findByRole('button', { name: 'Reportar error' })).toBeDisabled()
  })

  it('asks for a regeneration and for more examples through pathgen.regenerateLesson', async () => {
    const user = userEvent.setup()
    const api = stubApi([lessonRow()])
    render(<ExpansionPanel pathVersionId={PATH_VERSION_ID} />, { wrapper })

    await user.click(await screen.findByRole('button', { name: 'Regenerar' }))
    await waitFor(() =>
      expect(api.pathgen.regenerateLesson).toHaveBeenCalledWith({
        lessonId: LESSON_ID,
        mode: 'regenerate',
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Más ejemplos' }))
    await waitFor(() =>
      expect(api.pathgen.regenerateLesson).toHaveBeenCalledWith({
        lessonId: LESSON_ID,
        mode: 'more_examples',
      }),
    )
  })

  it('starts the expansion itself when the frozen path arrives with pending lessons', async () => {
    const api = stubApi([lessonRow({ status: 'pending' as const })])
    render(<ExpansionPanel pathVersionId={PATH_VERSION_ID} />, { wrapper })

    await waitFor(() =>
      expect(api.pathgen.expand).toHaveBeenCalledWith({ pathVersionId: PATH_VERSION_ID }),
    )
  })
})
