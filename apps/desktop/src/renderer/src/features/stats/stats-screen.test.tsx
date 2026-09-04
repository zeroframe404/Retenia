import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import '../../i18n'

/**
 * The six panels of `docs/spec/02-memory-system.md` §13, over a stubbed bridge.
 *
 * The charts themselves are not asserted on: they are lazy-loaded recharts SVG, and what
 * matters at this level is the numbers around them and the window switcher, which is the
 * only thing on the page that fetches again.
 */

const RETENTION = {
  day: {
    window: 'day' as const,
    from: '2026-06-15',
    young: { reviewed: 1, correct: 1, retention: 1 },
    mature: { reviewed: 2, correct: 1, retention: 0.5 },
    all: { reviewed: 3, correct: 2, retention: 2 / 3 },
  },
  week: {
    window: 'week' as const,
    from: '2026-06-09',
    young: { reviewed: 3, correct: 2, retention: 2 / 3 },
    mature: { reviewed: 2, correct: 1, retention: 0.5 },
    all: { reviewed: 5, correct: 3, retention: 0.6 },
  },
  month: {
    window: 'month' as const,
    from: '2026-05-17',
    young: { reviewed: 3, correct: 2, retention: 2 / 3 },
    mature: { reviewed: 3, correct: 1, retention: 1 / 3 },
    all: { reviewed: 6, correct: 3, retention: 0.5 },
  },
  year: {
    window: 'year' as const,
    from: '2025-06-16',
    young: { reviewed: 3, correct: 2, retention: 2 / 3 },
    mature: { reviewed: 4, correct: 2, retention: 0.5 },
    all: { reviewed: 7, correct: 4, retention: 4 / 7 },
  },
}

function overview(overrides: Record<string, unknown> = {}) {
  return {
    trueRetention: RETENTION.month,
    byLevel: [
      {
        level: 'normal',
        desiredRetention: 0.9,
        trueRetention: 0.88,
        reviewed: 40,
        gap: -0.02,
        alert: false,
      },
      {
        level: 'high',
        desiredRetention: 0.92,
        trueRetention: 0.5,
        reviewed: 2,
        gap: -0.42,
        alert: true,
      },
      // Never reviewed: the card should leave it out rather than print a row of dashes.
      {
        level: 'urgent',
        desiredRetention: 0.95,
        trueRetention: null,
        reviewed: 0,
        gap: null,
        alert: false,
      },
    ],
    retentionAlert: true,
    memorized: {
      today: 182.4,
      meanRetrievability: 0.947,
      reviewCards: 200,
      totalCards: 260,
      series: [
        { day: '2026-06-14', offset: 1, memorized: 180.1, cards: 200 },
        { day: '2026-06-15', offset: 0, memorized: 182.4, cards: 200 },
      ],
      generatedAt: '2026-06-15T12:00:00.000Z',
    },
    distribution: {
      stability: [
        { label: '<1d', from: 0, to: 1, count: 4, share: 0.02 },
        { label: '1–7d', from: 1, to: 7, count: 96, share: 0.48 },
        { label: '>1y', from: 365, to: null, count: 100, share: 0.5 },
      ],
      difficulty: [{ label: '5', from: 5, to: 6, count: 200, share: 1 }],
      cards: 200,
      shareOver21Days: 0.5,
      shareOver365Days: 0.5,
      meanStability: 210,
      meanDifficulty: 5,
    },
    forecast: {
      days: [
        {
          day: '2026-06-15',
          offset: 0,
          byLevel: { urgent: 0, high: 0, normal: 12, maintenance: 0, paused: 0 },
          cards: 12,
          minutes: 1.6,
          newCards: 0,
          cardsWithNew: 12,
          minutesWithNew: 1.6,
        },
      ],
      medianSecondsPerCard: 8,
      backlog: 3,
      newPool: 0,
      dailyNewLimit: 20,
      generatedAt: '2026-06-15T12:00:00.000Z',
    },
    generatedAt: '2026-06-15T12:00:00.000Z',
    ...overrides,
  }
}

function stubApi(data: ReturnType<typeof overview> | null, error?: string) {
  const trueRetention = vi.fn(async ({ window }: { window: keyof typeof RETENTION }) => ({
    ok: true,
    data: RETENTION[window],
  }))
  const api = {
    stats: {
      overview: vi.fn(async () =>
        error === undefined
          ? { ok: true, data }
          : { ok: false, error: { code: 'INTERNAL', message: error } },
      ),
      trueRetention,
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

const { StatsScreen } = await import('./stats-screen')

describe('StatsScreen', () => {
  it('renders the six panels of §13 from one overview call', async () => {
    const api = stubApi(overview())
    render(<StatsScreen />, { wrapper })

    await screen.findByTestId('stat-true-retention')
    for (const panel of [
      'stat-true-retention',
      'stat-by-level',
      'stat-mean-retention',
      'stat-memorized',
      'stat-distribution',
      'stat-forecast',
    ]) {
      expect(screen.getByTestId(panel)).toBeInTheDocument()
    }
    expect(api.stats.overview).toHaveBeenCalledTimes(1)
  })

  it('opens on the month window and shows its young/mature split', async () => {
    stubApi(overview())
    render(<StatsScreen />, { wrapper })

    // 3/6 over the month.
    expect(await screen.findByTestId('stat-true-retention-value')).toHaveTextContent('50.0 %')
    expect(screen.getByTestId('stat-true-retention-young')).toHaveTextContent('(2/3)')
    expect(screen.getByTestId('stat-true-retention-mature')).toHaveTextContent('(1/3)')
  })

  it('does not re-read the window the overview already answered', async () => {
    const api = stubApi(overview())
    render(<StatsScreen />, { wrapper })
    await screen.findByTestId('stat-true-retention-value')

    // The month came with the page; asking for it again would be a second pass over the
    // same rows.
    await waitFor(() => expect(api.stats.overview).toHaveBeenCalledTimes(1))
    expect(api.stats.trueRetention).not.toHaveBeenCalled()
  })

  it('reads another window only when the switcher asks for one', async () => {
    const api = stubApi(overview())
    render(<StatsScreen />, { wrapper })
    await screen.findByTestId('stat-true-retention')

    await userEvent.click(screen.getByRole('radio', { name: /hoy/i }))

    // 2/3 today.
    await waitFor(() =>
      expect(screen.getByTestId('stat-true-retention-value')).toHaveTextContent('66.7 %'),
    )
    expect(api.stats.trueRetention).toHaveBeenCalledWith({ window: 'day' })
    expect(api.stats.overview).toHaveBeenCalledTimes(1)
  })

  it('flags a level more than 5 pp off its target, and hides the ones never reviewed', async () => {
    stubApi(overview())
    render(<StatsScreen />, { wrapper })

    expect(await screen.findByTestId('stat-by-level-high-alert')).toHaveTextContent('−42.0 pp')
    expect(screen.getByTestId('stat-by-level-normal')).toBeInTheDocument()
    expect(screen.queryByTestId('stat-by-level-normal-alert')).not.toBeInTheDocument()
    expect(screen.queryByTestId('stat-by-level-urgent')).not.toBeInTheDocument()
  })

  it('shows mean retention and memorized knowledge as §13 defines them', async () => {
    stubApi(overview())
    render(<StatsScreen />, { wrapper })

    expect(await screen.findByTestId('stat-mean-retention-value')).toHaveTextContent('94.7 %')
    // `Σ R` rounded: "182 ítems".
    expect(screen.getByTestId('stat-memorized-value')).toHaveTextContent('182')
  })

  it('explains itself instead of showing six dashes when nothing has been studied', async () => {
    stubApi(
      overview({
        memorized: {
          today: 0,
          meanRetrievability: null,
          reviewCards: 0,
          totalCards: 0,
          series: [],
          generatedAt: '2026-06-15T12:00:00.000Z',
        },
      }),
    )
    render(<StatsScreen />, { wrapper })

    expect(await screen.findByText(/todavía no hay nada que medir/i)).toBeInTheDocument()
    expect(screen.queryByTestId('stat-true-retention')).not.toBeInTheDocument()
  })

  it('offers a retry when the read failed', async () => {
    const api = stubApi(null, 'the database did not open')
    render(<StatsScreen />, { wrapper })

    const retry = await screen.findByRole('button', { name: /reintentar/i })
    expect(screen.getByRole('alert')).toHaveTextContent(/no se pudieron leer/i)

    await userEvent.click(retry)
    await waitFor(() => expect(api.stats.overview).toHaveBeenCalledTimes(2))
  })
})
