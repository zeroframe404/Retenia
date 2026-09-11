import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import '../../i18n'

/**
 * The completion screen is where the expansion panel is actually mounted, so it is where
 * "Reportar error" is either wired or is not. It shipped unwired: `onOpenSource` is an
 * optional prop and this call site passed nothing, which made the button inert everywhere it
 * was rendered while still looking enabled.
 */

const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

const PATH_VERSION_ID = '019213cd-0000-7000-8000-000000000010'
const PATH_ID = '019213cd-0000-7000-8000-000000000011'
const SOURCE_ID = '019213cd-0000-7000-8000-00000000003a'

function ok<T>(data: T) {
  return { ok: true as const, data }
}

/** The renderer validates every IPC answer against the contract, so this has to be a whole
 *  `PathDraftDto` and not just the fields the screen happens to read. */
const DRAFT = {
  version: 1,
  kind: 'draft' as const,
  title: 'Física I',
  language: 'es-AR',
  target_language: null,
  level: 'beginner',
  goal: 'Aprobar',
  target_date: null,
  sources: [{ source_id: 'src-1', title: 'Fuente', primary: true }],
  sections: [
    {
      id: 'S01',
      title: 'Sección 1',
      modules: [
        {
          id: 'S01M1',
          title: 'Módulo 1',
          objectives: [],
          concept_ids: [],
          lessons: [
            {
              id: 'L01',
              kind: 'core' as const,
              title: 'Primera lección',
              concept_ids: ['c1'],
              warmup_concept_ids: [],
              objectives: [],
              prerequisite_lesson_ids: [],
              estimated_minutes: 10,
              source_refs: [],
              origin: 'model' as const,
            },
          ],
          reinforcement: {
            id: 'S01M1.reinf',
            kind: 'reinforcement' as const,
            module_id: 'S01M1',
            concept_ids: [],
            earlier_concept_ids: [],
            item_count: 5,
            estimated_minutes: 5,
          },
          checkpoint: null,
          estimated_minutes: 25,
        },
      ],
    },
  ],
  final_exam: {
    id: 'FINAL',
    kind: 'final_exam' as const,
    blueprint: { topics: [], item_count: 0 },
    estimated_minutes: 0,
  },
  misconceptions: [],
  excluded: [],
  stats: {
    sections: 1,
    modules: 1,
    lessons: 1,
    checkpoints: 0,
    concepts: 4,
    minutes: 25,
    weeks_estimate: null,
  },
  warnings: [],
  known_node_ids: [],
}

function stubApi(
  firstCitation: Record<string, unknown> | null,
  options: {
    affected?: { sources: unknown[]; lessons: unknown[] }
    regenerateResult?: Record<string, unknown>
    regenerateAffectedResult?: Record<string, unknown>
  } = {},
) {
  const api = {
    pathgen: {
      getVersion: vi.fn(async () =>
        ok({
          path: {
            id: PATH_ID,
            title: 'Física I',
            language: 'es-AR',
            level: 'beginner',
            goal: 'Aprobar',
            targetDate: null,
            status: 'active' as const,
            activeVersion: 1,
          },
          version: {
            id: PATH_VERSION_ID,
            pathId: PATH_ID,
            number: 1,
            frozenAt: '2026-09-09T00:00:00.000Z',
          },
          draft: DRAFT,
        }),
      ),
      getLessons: vi.fn(async () =>
        ok({
          lessons: [
            {
              id: '019213cd-0000-7000-8000-000000000020',
              specId: 'L01',
              moduleTitle: 'Módulo 1',
              title: 'Primera lección',
              status: 'ready' as const,
              activities: 5,
              flashcards: 4,
              unmet: [],
              warnings: [],
              firstCitation,
              qa: null,
            },
          ],
        }),
      ),
      expand: vi.fn(async () => ok({ runId: 'run-1', status: 'completed' })),
      regenerateLesson: vi.fn(async () => ok({ runId: 'run-1', status: 'completed' })),
      affectedLessons: vi.fn(async () => ok(options.affected ?? { sources: [], lessons: [] })),
      regenerate: vi.fn(async () =>
        ok(
          options.regenerateResult ?? {
            runId: 'run-2',
            pathId: PATH_ID,
            pathVersionId: 'new-version-id',
            status: 'completed' as const,
            warnings: [],
            draft: null,
            error: null,
          },
        ),
      ),
      regenerateAffected: vi.fn(async () =>
        ok(options.regenerateAffectedResult ?? { run: null, lessons: 0 }),
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

const { CompletionPage } = await import('./completion-page')

describe('CompletionPage', () => {
  it('opens the reader at the cited page when "Reportar error" is pressed', async () => {
    const user = userEvent.setup()
    navigate.mockClear()
    stubApi({ sourceId: SOURCE_ID, locator: 'p. 8', page: 8, blockIds: ['b1'] })
    render(<CompletionPage pathVersionId={PATH_VERSION_ID} />, { wrapper })

    await user.click(await screen.findByRole('button', { name: 'Reportar error' }))

    expect(navigate).toHaveBeenCalledWith({
      to: '/library',
      search: { sourceId: SOURCE_ID, page: 8 },
    })
  })

  it('opens the source at its start when the citation resolved to no page', async () => {
    const user = userEvent.setup()
    navigate.mockClear()
    stubApi({ sourceId: SOURCE_ID, locator: '12:30–13:45', page: null, blockIds: ['b1'] })
    render(<CompletionPage pathVersionId={PATH_VERSION_ID} />, { wrapper })

    await user.click(await screen.findByRole('button', { name: 'Reportar error' }))

    // A transcript has no page, and `/library`'s `page` is `z.int().positive()` — sending
    // `null` would make the route reject the search params rather than open the source.
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/library', search: { sourceId: SOURCE_ID } }),
    )
  })

  it('regenerates the path and opens the new version through onRegenerated', async () => {
    const user = userEvent.setup()
    const api = stubApi(null, {
      regenerateResult: {
        runId: '019213cd-0000-7000-8000-000000000042',
        pathId: PATH_ID,
        pathVersionId: '019213cd-0000-7000-8000-000000000043',
        status: 'completed' as const,
        warnings: [],
        draft: null,
        error: null,
      },
    })
    const onRegenerated = vi.fn()
    render(<CompletionPage pathVersionId={PATH_VERSION_ID} onRegenerated={onRegenerated} />, {
      wrapper,
    })

    await user.click(await screen.findByTestId('completion-regenerate'))

    await waitFor(() =>
      expect(api.pathgen.regenerate).toHaveBeenCalledExactlyOnceWith({ pathId: PATH_ID }),
    )
    await waitFor(() =>
      expect(onRegenerated).toHaveBeenCalledWith({
        pathVersionId: '019213cd-0000-7000-8000-000000000043',
        runId: '019213cd-0000-7000-8000-000000000042',
      }),
    )
  })

  it('shows an alert and does not open a version when regeneration wrote none', async () => {
    const user = userEvent.setup()
    stubApi(null, {
      regenerateResult: {
        runId: '019213cd-0000-7000-8000-000000000044',
        pathId: PATH_ID,
        pathVersionId: null,
        status: 'blocked_budget' as const,
        warnings: [],
        draft: null,
        error: 'Se superó el presupuesto mensual.',
      },
    })
    const onRegenerated = vi.fn()
    render(<CompletionPage pathVersionId={PATH_VERSION_ID} onRegenerated={onRegenerated} />, {
      wrapper,
    })

    await user.click(await screen.findByTestId('completion-regenerate'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Se superó el presupuesto mensual.')
    expect(onRegenerated).not.toHaveBeenCalled()
  })

  it('lists the affected lessons and regenerates them through pathgen.regenerateAffected', async () => {
    const user = userEvent.setup()
    const api = stubApi(null, {
      affected: {
        sources: [
          {
            sourceId: SOURCE_ID,
            title: 'Fuente actualizada',
            reason: 'chunks_changed' as const,
          },
        ],
        lessons: [
          {
            lessonId: '019213cd-0000-7000-8000-000000000201',
            specId: 'L02',
            title: 'Cinemática',
            sourceIds: [SOURCE_ID],
            missingFragments: 1,
          },
          {
            lessonId: '019213cd-0000-7000-8000-000000000202',
            specId: 'L03',
            title: 'Dinámica',
            sourceIds: [SOURCE_ID],
            missingFragments: 2,
          },
        ],
      },
    })
    render(<CompletionPage pathVersionId={PATH_VERSION_ID} />, { wrapper })

    expect(await screen.findByTestId('affected-lessons')).toBeInTheDocument()
    expect(screen.getAllByTestId('affected-lesson')).toHaveLength(2)

    await user.click(screen.getByTestId('regenerate-affected'))

    await waitFor(() =>
      expect(api.pathgen.regenerateAffected).toHaveBeenCalledExactlyOnceWith({
        pathVersionId: PATH_VERSION_ID,
      }),
    )
  })
})
