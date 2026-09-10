import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import '../../i18n'

/**
 * The editable preview (`docs/spec/04-path-generation.md` §13 step 3) over a stubbed bridge —
 * rename/reorder edits round-trip through `pathgen.editDraft`, and freezing disables further
 * edits.
 */

const PATH_VERSION_ID = '019213cd-0000-7000-8000-000000000010'
const PATH_ID = '019213cd-0000-7000-8000-000000000011'

function lesson(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'core' as const,
    title: `Lección ${id}`,
    concept_ids: ['c1', 'c2'],
    warmup_concept_ids: [],
    objectives: [],
    prerequisite_lesson_ids: [],
    estimated_minutes: 10,
    source_refs: [],
    origin: 'model' as const,
    ...overrides,
  }
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    kind: 'draft' as const,
    title: 'Física I',
    language: 'es-AR',
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
            lessons: [lesson('S01M1L1'), lesson('S01M1L2')],
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
      lessons: 2,
      checkpoints: 0,
      concepts: 4,
      minutes: 25,
      weeks_estimate: null,
    },
    warnings: [],
    known_node_ids: [],
    ...overrides,
  }
}

function ok<T>(data: T) {
  return { ok: true as const, data }
}

function stubApi(options: { frozenAt?: string | null } = {}) {
  let currentDraft = draft()
  const frozenAt = options.frozenAt ?? null

  const getVersion = vi.fn(async () =>
    ok({
      path: {
        id: PATH_ID,
        title: 'Física I',
        language: 'es-AR',
        level: 'beginner',
        goal: 'Aprobar',
        targetDate: null,
        status: frozenAt === null ? ('draft' as const) : ('active' as const),
        activeVersion: frozenAt === null ? null : 1,
      },
      version: { id: PATH_VERSION_ID, pathId: PATH_ID, number: 1, frozenAt },
      draft: currentDraft,
    }),
  )
  const editDraft = vi.fn(
    async ({ op }: { op: { kind: string; nodeId?: string; title?: string } }) => {
      if (op.kind === 'rename' && op.nodeId !== undefined && op.title !== undefined) {
        currentDraft = {
          ...currentDraft,
          sections: currentDraft.sections.map((section) =>
            section.id === op.nodeId ? { ...section, title: op.title as string } : section,
          ),
        }
      }
      return ok({ draft: currentDraft, warnings: [], breaksPrerequisite: false })
    },
  )
  const freeze = vi.fn(async () =>
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
      stats: currentDraft.stats,
    }),
  )

  const api = {
    pathgen: { getVersion, editDraft, freeze },
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

const { PreviewPage } = await import('./preview-page')

describe('PreviewPage', () => {
  it('renders the tree and renames a section through pathgen.editDraft', async () => {
    const user = userEvent.setup()
    const api = stubApi()
    render(<PreviewPage pathVersionId={PATH_VERSION_ID} onFrozen={vi.fn()} />, { wrapper })

    const titleButton = await screen.findByTestId('section-title-S01')
    await user.click(titleButton)
    const input = screen.getByDisplayValue('Sección 1')
    await user.clear(input)
    await user.type(input, 'Sección renombrada')
    await user.tab()

    await waitFor(() =>
      expect(api.pathgen.editDraft).toHaveBeenCalledWith({
        pathVersionId: PATH_VERSION_ID,
        op: { kind: 'rename', nodeId: 'S01', title: 'Sección renombrada' },
      }),
    )
  })

  it('disables edit controls once the version is frozen', async () => {
    stubApi({ frozenAt: '2026-09-09T00:00:00.000Z' })
    render(<PreviewPage pathVersionId={PATH_VERSION_ID} onFrozen={vi.fn()} />, { wrapper })

    expect(await screen.findByTestId('preview-freeze')).toBeDisabled()
    expect(screen.getByTestId('section-exclude-S01')).toBeDisabled()
  })

  it('freezes the path and calls onFrozen', async () => {
    const user = userEvent.setup()
    const api = stubApi()
    const onFrozen = vi.fn()
    render(<PreviewPage pathVersionId={PATH_VERSION_ID} onFrozen={onFrozen} />, { wrapper })

    await user.click(await screen.findByTestId('preview-freeze'))

    await waitFor(() =>
      expect(api.pathgen.freeze).toHaveBeenCalledExactlyOnceWith({
        pathVersionId: PATH_VERSION_ID,
      }),
    )
    await waitFor(() => expect(onFrozen).toHaveBeenCalledWith(PATH_VERSION_ID))
  })
})
