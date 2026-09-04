import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'

const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

const overload = {
  plannedCards: 0,
  keptCards: 0,
  postponedCards: 0,
  completedShare: 1,
  byLevel: [],
  budgetMinutes: 20,
  estimatedMinutes: 0,
  overloaded: false,
  stillOverBudget: false,
}

const importanceMix = {
  entries: [],
  totalItems: 0,
  totalCards: 0,
  prioritizedShare: 0,
  threshold: 0.3,
  biasWarning: false,
  computedAt: '2026-09-02T00:00:00.000Z',
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    counts: {
      exam: 0,
      due: 0,
      relearning: 0,
      new: 0,
      reinforcement: 0,
      total: 0,
      byLevel: { urgent: 0, high: 0, normal: 0, maintenance: 0, paused: 0 },
    },
    overload,
    postponements: 0,
    burials: 0,
    estimatedMinutes: 0,
    budgetMinutes: 20,
    streakGoalCards: 10,
    medianSecondsPerCard: 8,
    backlogDays: 0,
    newGated: false,
    finalDrill: false,
    order: 'relative_overdueness' as const,
    seed: '1',
    composedAt: '2026-09-02T00:00:00.000Z',
    ...overrides,
  }
}

function stubApi(planData: ReturnType<typeof plan>) {
  const api = {
    session: {
      plan: vi.fn(async () => ({ ok: true, data: planData })),
    },
    memory: {
      importanceMix: vi.fn(async () => ({ ok: true, data: importanceMix })),
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

const { TodayCard } = await import('./today-card')

describe('TodayCard', () => {
  beforeEach(() => {
    navigate.mockClear()
  })

  it('disables the primary action and says so when nothing is due', async () => {
    stubApi(plan())
    render(<TodayCard />, { wrapper })

    expect(await screen.findByText(/no hay nada pendiente/i)).toBeInTheDocument()
    expect(screen.getByTestId('today-primary-action')).toBeDisabled()
  })

  it('shows the due-per-level breakdown and starts a review from session.plan', async () => {
    stubApi(
      plan({
        counts: {
          exam: 0,
          due: 30,
          relearning: 2,
          new: 3,
          reinforcement: 1,
          total: 36,
          byLevel: { urgent: 5, high: 10, normal: 15, maintenance: 0, paused: 0 },
        },
        estimatedMinutes: 12,
      }),
    )
    render(<TodayCard />, { wrapper })

    await waitFor(() => expect(screen.getByTestId('today-due-urgent')).toHaveTextContent('5'))
    expect(screen.getByTestId('today-due-high')).toHaveTextContent('10')
    expect(screen.getByTestId('today-due-normal')).toHaveTextContent('15')
    expect(screen.queryByTestId('today-due-maintenance')).not.toBeInTheDocument()
    expect(screen.getByTestId('today-new')).toHaveTextContent('3')
    expect(screen.getByTestId('today-reinforcement')).toBeInTheDocument()

    const primary = screen.getByTestId('today-primary-action')
    expect(primary).not.toBeDisabled()
    expect(primary).toHaveTextContent('12')

    await userEvent.click(primary)
    expect(navigate).toHaveBeenCalledWith({ to: '/review' })
  })

  it('shows the importance-mix bias warning banner when the queue is skewed', async () => {
    const api = stubApi(plan())
    api.memory.importanceMix = vi.fn(async () => ({
      ok: true,
      data: { ...importanceMix, biasWarning: true, prioritizedShare: 0.42 },
    }))
    render(<TodayCard />, { wrapper })

    expect(await screen.findByTestId('importance-mix-banner')).toHaveTextContent('42')
  })
})
