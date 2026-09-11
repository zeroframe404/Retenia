import { sampleChoice } from '@retenia/activity-schema/testing/samples'
import type {
  DiagnosticItemDto,
  DiagnosticStateDto,
  DiagnosticStopReasonDto,
  ItemBankStatusDto,
} from '@retenia/ipc-contract'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import { DiagnosticPage } from './diagnostic-page'

/**
 * The prior-knowledge diagnostic (sub-phase 8.5, `docs/spec/04-path-generation.md` §10 and §13
 * step 4) over a stubbed bridge.
 *
 * The stub keeps the session's state the way main does — every write answers with the next
 * state and the next read returns it — because the page writes each answer into the cache
 * *and* re-reads, and a stub that forgot the answer would send the loop back to its first item.
 * The items go through the real `<ActivityHost/>`, so what reaches `diagnosticAnswer` is what
 * the host actually produces, confidence included.
 */

const PATH_VERSION_ID = '019213cd-0000-7000-8000-000000000010'
const SESSION_ID = '019213cd-0000-7000-8000-000000000020'
const SECTION_A = '019213cd-0000-7000-8000-000000000031'
const SECTION_B = '019213cd-0000-7000-8000-000000000032'
const SECTION_KNOWN = '019213cd-0000-7000-8000-000000000033'
const ATTEMPT_1 = '019213cd-0000-7000-8000-000000000051'
const ATTEMPT_2 = '019213cd-0000-7000-8000-000000000052'
const ITEM_BANK_ID = '019213cd-0000-7000-8000-000000000061'

function ok<T>(data: T) {
  return { ok: true as const, data }
}

function bank(overrides: Partial<ItemBankStatusDto> = {}): ItemBankStatusDto {
  return {
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
    ...overrides,
  }
}

const SECTIONS = [
  {
    id: SECTION_A,
    specId: 'S01',
    title: 'Cinemática',
    modules: [{ id: '019213cd-0000-7000-8000-000000000041', specId: 'S01M1', title: 'Rectilíneo' }],
    selfDeclared: false,
  },
  {
    id: SECTION_B,
    specId: 'S02',
    title: 'Dinámica',
    modules: [
      { id: '019213cd-0000-7000-8000-000000000042', specId: 'S02M1', title: 'Newton' },
      { id: '019213cd-0000-7000-8000-000000000043', specId: 'S02M2', title: 'Energía' },
    ],
    selfDeclared: false,
  },
  {
    id: SECTION_KNOWN,
    specId: 'S03',
    title: 'Unidades',
    modules: [{ id: '019213cd-0000-7000-8000-000000000044', specId: 'S03M1', title: 'SI' }],
    selfDeclared: true,
  },
]

function item(attemptId: string): DiagnosticItemDto {
  return {
    itemBankId: ITEM_BANK_ID,
    attemptId,
    activityId: sampleChoice().id,
    type: 'mcq_single',
    activity: sampleChoice() as unknown as DiagnosticItemDto['activity'],
    seed: `seed-${attemptId}`,
  }
}

function inProgress(
  attemptId: string,
  progress: { asked: number; remaining: number; elapsedMs?: number },
): DiagnosticStateDto {
  return {
    session: {
      id: SESSION_ID,
      pathVersionId: PATH_VERSION_ID,
      status: 'in_progress',
      entry: 'partial',
      startedAt: '2026-09-11T10:00:00.000Z',
      finishedAt: null,
      stopReason: null,
    },
    progress: {
      asked: progress.asked,
      remaining: progress.remaining,
      elapsedMs: progress.elapsedMs ?? 0,
      maxItems: 30,
    },
    item: item(attemptId),
    result: null,
  }
}

function completed(
  stopReason: DiagnosticStopReasonDto,
  entry: 'scratch' | 'partial' = 'partial',
): DiagnosticStateDto {
  return {
    session: {
      id: SESSION_ID,
      pathVersionId: PATH_VERSION_ID,
      status: 'completed',
      entry,
      startedAt: '2026-09-11T10:00:00.000Z',
      finishedAt: '2026-09-11T10:12:00.000Z',
      stopReason,
    },
    progress: { asked: 3, remaining: 0, elapsedMs: 180_000, maxItems: 30 },
    item: null,
    result: { stopReason, asked: 3, elapsedMs: 180_000, modules: [], remediations: [] },
  }
}

interface StubOptions {
  state: DiagnosticStateDto | null
  itemBank?: ItemBankStatusDto
  /** What `getItemBank` answers; the seeded bank when absent. */
  polledBank?: ItemBankStatusDto
  onStart?: (input: { entry: string }) => DiagnosticStateDto
  onAnswer?: () => DiagnosticStateDto
}

function stubApi(options: StubOptions) {
  let current = options.state
  const seededBank = options.itemBank ?? bank()
  const write = (next: DiagnosticStateDto) => {
    current = next
    return ok(next)
  }
  const api = {
    pathgen: {
      diagnosticGet: vi.fn(async () =>
        ok({ sections: SECTIONS, state: current, itemBank: seededBank }),
      ),
      getItemBank: vi.fn(async () => ok(options.polledBank ?? seededBank)),
      buildItemBank: vi.fn(async () =>
        ok(
          bank({
            state: 'building',
            diagnosticItems: 0,
            cells: { total: 6, built: 0, short: 0, failed: 0 },
          }),
        ),
      ),
      diagnosticStart: vi.fn(async (input: { entry: string }) =>
        write(options.onStart?.(input) ?? completed('from_scratch', 'scratch')),
      ),
      diagnosticAnswer: vi.fn(async () =>
        write(options.onAnswer?.() ?? completed('all_classified')),
      ),
      diagnosticFinish: vi.fn(async () => write(completed('abandoned'))),
    },
    events: { on: vi.fn(() => vi.fn()) },
  }
  vi.stubGlobal('api', api)
  window.api = api as unknown as typeof window.api
  return api
}

function renderPage(props: { onDone?: () => void; onResult?: () => void } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onDone = props.onDone ?? vi.fn()
  const onResult = props.onResult ?? vi.fn()
  render(
    <QueryClientProvider client={client}>
      <DiagnosticPage pathVersionId={PATH_VERSION_ID} onDone={onDone} onResult={onResult} />
    </QueryClientProvider>,
  )
  return { onDone, onResult }
}

afterEach(cleanup)

describe('DiagnosticPage', () => {
  it('resumes an in-progress session straight into the item loop', async () => {
    const api = stubApi({
      state: inProgress(ATTEMPT_1, { asked: 4, remaining: 5, elapsedMs: 65_000 }),
    })
    renderPage()

    expect(await screen.findByTestId('activity-host')).toBeInTheDocument()
    expect(screen.getByTestId('diagnostic-remaining')).toHaveTextContent('Quedan ~5 preguntas')
    // The session's elapsed time plus the local clock for the item on screen.
    expect(screen.getByTestId('diagnostic-elapsed').textContent).toMatch(/^1:0\d$/)
    expect(screen.queryByTestId('diagnostic-entry')).not.toBeInTheDocument()
    expect(api.pathgen.diagnosticStart).not.toHaveBeenCalled()
  })

  it('"Desde cero" starts a scratch session and hands over to the completion screen', async () => {
    const user = userEvent.setup()
    const api = stubApi({ state: null })
    const { onDone, onResult } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Desde cero' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(api.pathgen.diagnosticStart).toHaveBeenCalledWith({
      pathVersionId: PATH_VERSION_ID,
      entry: 'scratch',
      selfAssessment: {},
    })
    // Scratch finishes at once, but there is nothing to summarise.
    expect(onResult).not.toHaveBeenCalled()
  })

  it('sends one level per section id and never asks about sections known in the preview', async () => {
    const user = userEvent.setup()
    const api = stubApi({
      state: null,
      onStart: () => inProgress(ATTEMPT_1, { asked: 0, remaining: 8 }),
    })
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Ya sé parte' }))

    const kinematics = screen.getByRole('radiogroup', { name: 'Cinemática' })
    const dynamics = screen.getByRole('radiogroup', { name: 'Dinámica' })
    expect(screen.queryByRole('radiogroup', { name: 'Unidades' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('self-assessment-row-S03')).not.toBeInTheDocument()
    expect(screen.getByTestId('self-assessment-declared-S03')).toHaveTextContent(
      'Marcado como sabido en la vista previa',
    )
    expect(screen.getByText(/«Nunca lo vi» no se preguntan/)).toBeInTheDocument()
    // The default is "Me suena".
    expect(within(kinematics).getByRole('radio', { name: 'Me suena' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await user.click(within(dynamics).getByRole('radio', { name: 'Nunca lo vi' }))
    await user.click(screen.getByRole('button', { name: 'Empezar diagnóstico' }))

    await waitFor(() =>
      expect(api.pathgen.diagnosticStart).toHaveBeenCalledWith({
        pathVersionId: PATH_VERSION_ID,
        entry: 'partial',
        selfAssessment: { [SECTION_A]: 'familiar', [SECTION_B]: 'never' },
      }),
    )
    expect(await screen.findByTestId('activity-host')).toBeInTheDocument()
    expect(screen.getByTestId('diagnostic-remaining')).toHaveTextContent('Quedan ~8 preguntas')
  })

  it('answers through the real host with the attempt id and the chosen confidence', async () => {
    const user = userEvent.setup()
    const api = stubApi({
      state: inProgress(ATTEMPT_1, { asked: 2, remaining: 4 }),
      onAnswer: () => inProgress(ATTEMPT_2, { asked: 3, remaining: 1 }),
    })
    renderPage()

    // The family renderers are lazy chunks, so the first query waits for one to load.
    await user.click(await screen.findByTestId('option-a'))
    // `sampleChoice()` does not ask for confidence; the diagnostic always does.
    expect(screen.getByText('¿Qué tan seguro estás?')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Seguro' }))
    await user.click(screen.getByTestId('check-button'))

    await waitFor(() => expect(api.pathgen.diagnosticAnswer).toHaveBeenCalledTimes(1))
    expect(api.pathgen.diagnosticAnswer).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      attemptId: ATTEMPT_1,
      skipped: false,
      response: { sets: [{ selected: ['a'] }], confidence: 'sure' },
      confidence: 'sure',
      timeMs: expect.any(Number),
    })

    expect(await screen.findByText('Queda ~1 pregunta')).toBeInTheDocument()
    expect(screen.getByTestId('diagnostic-answer-status')).toHaveTextContent('Respuesta guardada')
    // Never a verdict: no correct/incorrect wording anywhere on the screen.
    expect(screen.queryByText(/incorrect/i)).not.toBeInTheDocument()
  })

  it('offers the confidence levels as Seguro / Probable / Adiviné', async () => {
    stubApi({ state: inProgress(ATTEMPT_1, { asked: 0, remaining: 6 }) })
    renderPage()

    await screen.findByTestId('confidence-picker')
    expect(screen.getByRole('radio', { name: 'Seguro' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Probable' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Adiviné' })).toBeInTheDocument()
  })

  it('sends a skip as skipped, with no response and no confidence', async () => {
    const user = userEvent.setup()
    const api = stubApi({
      state: inProgress(ATTEMPT_1, { asked: 1, remaining: 5 }),
      onAnswer: () => inProgress(ATTEMPT_2, { asked: 2, remaining: 4 }),
    })
    renderPage()

    await user.click(await screen.findByTestId('skip-button'))

    await waitFor(() => expect(api.pathgen.diagnosticAnswer).toHaveBeenCalledTimes(1))
    expect(api.pathgen.diagnosticAnswer).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      attemptId: ATTEMPT_1,
      skipped: true,
      confidence: null,
      timeMs: expect.any(Number),
    })
  })

  it('waits for the item bank while it builds, and "Desde cero" still works meanwhile', async () => {
    const user = userEvent.setup()
    const api = stubApi({
      state: null,
      itemBank: bank({
        state: 'building',
        diagnosticItems: 3,
        cells: { total: 6, built: 2, short: 0, failed: 0 },
      }),
    })
    const { onDone } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Ya sé parte' }))
    const waiting = screen.getByTestId('diagnostic-bank-waiting')
    expect(waiting).toHaveTextContent('Preparando las preguntas…')
    expect(waiting).toHaveTextContent('2 de 6 grupos listos · 3 preguntas listas')
    expect(screen.getByRole('button', { name: 'Empezar diagnóstico' })).toBeDisabled()
    await waitFor(() =>
      expect(api.pathgen.getItemBank).toHaveBeenCalledWith({ pathVersionId: PATH_VERSION_ID }),
    )

    await user.click(screen.getByRole('button', { name: 'Volver' }))
    await user.click(screen.getByRole('button', { name: 'Desde cero' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(api.pathgen.diagnosticStart).toHaveBeenCalledWith(
      expect.objectContaining({ entry: 'scratch' }),
    )
  })

  it('lets the diagnostic begin once the polled bank is ready', async () => {
    const user = userEvent.setup()
    stubApi({
      state: null,
      itemBank: bank({ state: 'building', cells: { total: 6, built: 5, short: 0, failed: 0 } }),
      polledBank: bank(),
    })
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Ya sé parte' }))

    await waitFor(() =>
      expect(screen.queryByTestId('diagnostic-bank-waiting')).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Empezar diagnóstico' })).toBeEnabled()
  })

  it('offers to rebuild a bank that failed', async () => {
    const user = userEvent.setup()
    const api = stubApi({
      state: null,
      itemBank: bank({ state: 'failed', diagnosticItems: 0, error: 'boom' }),
      polledBank: bank({ state: 'building', diagnosticItems: 0 }),
    })
    renderPage()

    expect(await screen.findByTestId('diagnostic-bank-failed')).toHaveTextContent(
      'No se pudieron preparar las preguntas del diagnóstico.',
    )
    await user.click(screen.getByRole('button', { name: 'Volver a intentar' }))

    await waitFor(() =>
      expect(api.pathgen.buildItemBank).toHaveBeenCalledWith({ pathVersionId: PATH_VERSION_ID }),
    )
    expect(await screen.findByTestId('diagnostic-bank-waiting')).toBeInTheDocument()
  })

  it('keeps "Ya sé parte" closed when the bank settled without a diagnostic question', async () => {
    const user = userEvent.setup()
    const api = stubApi({
      state: null,
      itemBank: bank({ state: 'partial', diagnosticItems: 0 }),
      polledBank: bank({ state: 'building', diagnosticItems: 0 }),
    })
    renderPage()

    const notice = await screen.findByTestId('diagnostic-bank-no-items')
    expect(notice).toHaveTextContent('Esta ruta todavía no tiene preguntas de diagnóstico.')
    expect(notice).toHaveTextContent('podés volver a intentar armarlas o empezar desde cero')
    expect(screen.getByRole('button', { name: 'Ya sé parte' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Desde cero' })).toBeEnabled()

    await user.click(within(notice).getByRole('button', { name: 'Volver a intentar' }))

    await waitFor(() =>
      expect(api.pathgen.buildItemBank).toHaveBeenCalledWith({ pathVersionId: PATH_VERSION_ID }),
    )
    // Building again: the self-assessment can be filled in while the questions are written.
    expect(await screen.findByTestId('diagnostic-bank-waiting')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ya sé parte' })).toBeEnabled()
  })

  it('lets the diagnostic begin from the questions a bank kept, even after a failed rebuild', async () => {
    const user = userEvent.setup()
    stubApi({ state: null, itemBank: bank({ state: 'failed', diagnosticItems: 5, error: 'boom' }) })
    renderPage()

    expect(await screen.findByTestId('diagnostic-bank-failed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ya sé parte' }))

    expect(screen.getByRole('button', { name: 'Empezar diagnóstico' })).toBeEnabled()
  })

  it('"Terminar ahora" asks first, then finishes and opens the result', async () => {
    const user = userEvent.setup()
    const api = stubApi({ state: inProgress(ATTEMPT_1, { asked: 5, remaining: 3 }) })
    const { onResult } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Terminar ahora' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Se guarda lo que ya respondiste')
    expect(api.pathgen.diagnosticFinish).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Terminar' }))

    await waitFor(() =>
      expect(api.pathgen.diagnosticFinish).toHaveBeenCalledWith({ sessionId: SESSION_ID }),
    )
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1))
  })

  it('opens the result when the last answer finishes the diagnostic', async () => {
    const user = userEvent.setup()
    stubApi({
      state: inProgress(ATTEMPT_1, { asked: 7, remaining: 1 }),
      onAnswer: () => completed('all_classified'),
    })
    const { onResult } = renderPage()

    await user.click(await screen.findByTestId('skip-button'))

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1))
  })

  it('opens the result straight away for a session that already finished', async () => {
    stubApi({ state: completed('max_items') })
    const { onResult, onDone } = renderPage()

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1))
    expect(onDone).not.toHaveBeenCalled()
  })
})
