import type {
  DiagnosticModuleResultDto,
  DiagnosticStateDto,
  ItemBankStatusDto,
} from '@retenia/ipc-contract'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import { DiagnosticResultPage } from './diagnostic-result-page'

/**
 * The diagnostic's summary (§13 step 4: *"summary of what is marked completed, reversible"*)
 * over a stubbed bridge: what each module became, the one-click undo per module and for all of
 * them, and the Elo values kept behind "Avanzado".
 */

const PATH_VERSION_ID = '019213cd-0000-7000-8000-000000000010'
const SESSION_ID = '019213cd-0000-7000-8000-000000000020'
const MOD_1 = '019213cd-0000-7000-8000-000000000071'
const MOD_2 = '019213cd-0000-7000-8000-000000000072'
const MOD_3 = '019213cd-0000-7000-8000-000000000073'
const MOD_4 = '019213cd-0000-7000-8000-000000000074'
const MOD_5 = '019213cd-0000-7000-8000-000000000075'

function ok<T>(data: T) {
  return { ok: true as const, data }
}

const BANK: ItemBankStatusDto = {
  pathVersionId: PATH_VERSION_ID,
  state: 'ready',
  items: 36,
  diagnosticItems: 12,
  byUsage: {
    diagnostic: 12,
    reinforcement: 12,
    final_exam_A: 6,
    final_exam_B: 6,
    remediation: 0,
    mock: 0,
  },
  cells: { total: 6, built: 6, short: 0, failed: 0 },
  warnings: [],
  error: null,
}

function module(
  overrides: Partial<DiagnosticModuleResultDto> &
    Pick<DiagnosticModuleResultDto, 'moduleId' | 'specId' | 'title' | 'sectionTitle'>,
): DiagnosticModuleResultDto {
  return {
    status: 'known',
    source: 'diagnostic',
    theta: 1,
    p: 0.73,
    answered: 2,
    inferred: 0,
    quickReview: false,
    lessonsCompleted: 2,
    seededCards: 6,
    pendingSeedLessons: 0,
    reverted: false,
    reopened: false,
    reopenReason: null,
    ...overrides,
  }
}

const MODULES = [
  module({
    moduleId: MOD_1,
    specId: 'S01M1',
    title: 'Movimiento rectilíneo',
    sectionTitle: 'Cinemática',
    theta: 1.234,
    p: 0.774,
    answered: 2,
    inferred: 1,
    lessonsCompleted: 3,
    seededCards: 12,
    pendingSeedLessons: 1,
  }),
  module({ moduleId: MOD_2, specId: 'S01M2', title: 'Tiro oblicuo', sectionTitle: 'Cinemática' }),
  module({
    moduleId: MOD_3,
    specId: 'S02M1',
    title: 'Leyes de Newton',
    sectionTitle: 'Dinámica',
    status: 'partial',
    quickReview: true,
    theta: 0.1,
    p: 0.52,
    lessonsCompleted: 0,
    seededCards: 0,
  }),
  module({
    moduleId: MOD_4,
    specId: 'S02M2',
    title: 'Energía',
    sectionTitle: 'Dinámica',
    status: 'unknown',
    source: 'never_seen',
    theta: -1.5,
    p: 0.18,
    answered: 0,
    lessonsCompleted: 0,
    seededCards: 0,
  }),
  module({
    moduleId: MOD_5,
    specId: 'S03M1',
    title: 'Unidades',
    sectionTitle: 'Magnitudes',
    reopened: true,
    reopenReason: 'lapses',
  }),
]

function state(modules: DiagnosticModuleResultDto[] = MODULES): DiagnosticStateDto {
  return {
    session: {
      id: SESSION_ID,
      pathVersionId: PATH_VERSION_ID,
      status: 'completed',
      entry: 'partial',
      startedAt: '2026-09-11T10:00:00.000Z',
      finishedAt: '2026-09-11T10:12:34.000Z',
      stopReason: 'all_classified',
    },
    progress: { asked: 9, remaining: 0, elapsedMs: 754_000, maxItems: 30 },
    item: null,
    result: {
      stopReason: 'all_classified',
      asked: 9,
      elapsedMs: 754_000,
      modules,
      remediations: [
        { moduleId: MOD_3, conceptIds: ['c-fuerza'], misconceptionId: 'mc-1' },
        { moduleId: MOD_4, conceptIds: ['c-energia'], misconceptionId: null },
      ],
    },
  }
}

/** Reverting marks the named module — or every revertible one — `reverted`, as main does. */
function reverted(input: { moduleId?: string }): DiagnosticStateDto {
  return state(
    MODULES.map((m) =>
      (
        input.moduleId === undefined
          ? m.status === 'known' && !m.reopened
          : m.moduleId === input.moduleId
      )
        ? { ...m, reverted: true }
        : m,
    ),
  )
}

function stubApi() {
  let current = state()
  const api = {
    pathgen: {
      diagnosticGet: vi.fn(async () => ok({ sections: [], state: current, itemBank: BANK })),
      diagnosticRevert: vi.fn(async (input: { sessionId: string; moduleId?: string }) => {
        current = reverted(input)
        return ok(current)
      }),
    },
    events: { on: vi.fn(() => vi.fn()) },
  }
  vi.stubGlobal('api', api)
  window.api = api as unknown as typeof window.api
  return api
}

function renderPage(onContinue: () => void = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <DiagnosticResultPage pathVersionId={PATH_VERSION_ID} onContinue={onContinue} />
    </QueryClientProvider>,
  )
  return { onContinue }
}

afterEach(cleanup)

describe('DiagnosticResultPage', () => {
  it('summarises what each module became and what was done about it', async () => {
    stubApi()
    renderPage()

    await screen.findByTestId('diagnostic-result-page')
    // The reopened module is back to being studied, whatever the diagnostic said.
    expect(screen.getByTestId('diagnostic-stat-known')).toHaveTextContent('2')
    expect(screen.getByTestId('diagnostic-stat-partial')).toHaveTextContent('1')
    expect(screen.getByTestId('diagnostic-stat-unknown')).toHaveTextContent('2')
    expect(screen.getByTestId('diagnostic-stat-asked')).toHaveTextContent('9')
    expect(screen.getByTestId('diagnostic-stat-time')).toHaveTextContent('12:34')
    expect(screen.getByTestId('diagnostic-stop-reason')).toHaveTextContent(
      'Terminamos cuando todos los módulos quedaron ubicados.',
    )
    expect(screen.getByTestId('diagnostic-remediations')).toHaveTextContent(
      'Detectamos 2 ideas a reforzar; se agregarán refuerzos a tu ruta.',
    )

    const first = screen.getByTestId('diagnostic-module-S01M1')
    expect(first).toHaveTextContent('Ya lo sabés')
    expect(first).toHaveTextContent(
      '3 lecciones marcadas como completadas · 12 tarjetas sembradas · 1 lección espera sus tarjetas',
    )
    expect(screen.getByTestId('diagnostic-module-S02M1')).toHaveTextContent('Repaso rápido')
    const energy = screen.getByTestId('diagnostic-module-S02M2')
    expect(energy).toHaveTextContent('Por estudiar')
    expect(energy).toHaveTextContent('Lo marcaste como «Nunca lo vi»')
    const reopened = screen.getByTestId('diagnostic-module-S03M1')
    expect(reopened).toHaveTextContent('Reabierto por repasos fallidos')
    expect(within(reopened).queryByRole('button')).not.toBeInTheDocument()
  })

  it('keeps the Elo values hidden until "Avanzado" is switched on', async () => {
    const user = userEvent.setup()
    stubApi()
    renderPage()

    await screen.findByTestId('diagnostic-result-page')
    expect(screen.queryByText(/θ/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('diagnostic-module-advanced-S01M1')).not.toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Avanzado' }))

    const advanced = screen.getByTestId('diagnostic-module-advanced-S01M1')
    expect(advanced).toHaveTextContent('θ 1.23')
    expect(advanced).toHaveTextContent('P 77 %')
    expect(advanced).toHaveTextContent('2 respondidas / 1 inferidas')
    expect(screen.getByTestId('diagnostic-module-advanced-S02M2')).toHaveTextContent('θ -1.50')
  })

  it('"Deshacer" on one module reverts only that module', async () => {
    const user = userEvent.setup()
    const api = stubApi()
    renderPage()

    await user.click(
      await screen.findByRole('button', { name: 'Deshacer «Movimiento rectilíneo»' }),
    )

    await waitFor(() =>
      expect(api.pathgen.diagnosticRevert).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        moduleId: MOD_1,
      }),
    )
    const row = screen.getByTestId('diagnostic-module-S01M1')
    await waitFor(() => expect(within(row).getByText('Deshecho')).toBeInTheDocument())
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deshacer «Tiro oblicuo»' })).toBeInTheDocument()
  })

  it('"Deshacer todo" asks first, then reverts every module at once', async () => {
    const user = userEvent.setup()
    const api = stubApi()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Deshacer todo' }))
    const dialog = await screen.findByRole('dialog')
    expect(api.pathgen.diagnosticRevert).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Deshacer todo' }))

    await waitFor(() =>
      expect(api.pathgen.diagnosticRevert).toHaveBeenCalledWith({ sessionId: SESSION_ID }),
    )
    expect(api.pathgen.diagnosticRevert.mock.calls[0]?.[0]).not.toHaveProperty('moduleId')
    await waitFor(() =>
      expect(
        within(screen.getByTestId('diagnostic-module-S01M2')).getByText('Deshecho'),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('diagnostic-revert-all')).not.toBeInTheDocument()
  })

  it('"Continuar" hands over to the completion screen', async () => {
    const user = userEvent.setup()
    stubApi()
    const { onContinue } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Continuar' }))

    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})
