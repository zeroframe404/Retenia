import type { RetentionWindow, StatsOverview } from '@retenia/ipc-contract'
import { RETENTION_WINDOWS } from '@retenia/ipc-contract'
import { Badge, EmptyState, ErrorState, SegmentedControl, Skeleton } from '@retenia/ui'
import { lazy, Suspense, useState } from 'react'
import { useT } from '../../i18n/use-t'
import { useIpcQuery } from '../../ipc/hooks'
import { StatCard } from './components/stat-card'

/**
 * The statistics screen — the first six rows of `docs/spec/02-memory-system.md` §13.
 *
 * One `stats.overview` call draws the whole page; only the true-retention window switcher
 * fetches again, and only its own card. The charts are behind `lazy()` so recharts stays
 * out of the app's first paint (`./charts.tsx`).
 *
 * The panels are ordered as §13 lists them, which is also roughly least-to-most derived:
 * true retention is a count of things that happened, and memorized knowledge is a model's
 * opinion. `docs/spec/01-decisions.md` §7.2 — "the scheduler is transparent" — is why every
 * card carries a sentence saying what its number actually measures.
 */

const Charts = {
  Series: lazy(async () => ({ default: (await import('./charts')).SeriesChart })),
  Histogram: lazy(async () => ({ default: (await import('./charts')).HistogramChart })),
}

/** How many days of `Σ R` and of forecast the screen asks for. §13 offers 30/90. */
const SERIES_DAYS = 30
const FORECAST_DAYS = 30
/** How long the seeded window stays fresh — long enough that returning to it after trying
 *  the others does not re-read what the page already had. */
const RETENTION_STALE_MS = 60_000

/** A chart's placeholder while its chunk loads — the same height, so nothing jumps. */
function ChartFallback() {
  return <Skeleton className="h-40 w-full compact:h-32" />
}

function percent(value: number | null, fallback = '—'): string {
  if (value === null || !Number.isFinite(value)) return fallback
  return `${(value * 100).toFixed(1)} %`
}

function points(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const pp = value * 100
  return `${pp >= 0 ? '+' : '−'}${Math.abs(pp).toFixed(1)} pp`
}

/**
 * §13 row 1, with its own query.
 *
 * The overview already answered the month window — reading it again on mount would be a
 * second pass over the same rows — so that one is seeded from what the page arrived with
 * and only the other three cost a read. Those three are exactly the reads the overview
 * declines to make: `year` walks a year of `review_logs`, and it should do so when someone
 * asks for a year, not on every visit to the screen.
 */
function TrueRetentionCard({ initial }: { initial: StatsOverview }) {
  const t = useT('statistics')
  const [window, setWindow] = useState<RetentionWindow>(initial.trueRetention.window)
  const seeded = window === initial.trueRetention.window
  const { data } = useIpcQuery(
    'stats.trueRetention',
    { window },
    seeded
      ? {
          initialData: initial.trueRetention,
          // Without a timestamp the seed counts as stale and is refetched at once, which is
          // the duplicate read the seeding exists to avoid. It is `Date.now()` rather than
          // `initial.generatedAt` because what this marks is when the *renderer* got the
          // data, and the overview that carried it resolved just now — reading main's own
          // clock instead would make the seed's freshness depend on clock skew between two
          // processes on the same machine.
          initialDataUpdatedAt: Date.now(),
          staleTime: RETENTION_STALE_MS,
        }
      : {},
  )
  const retention = data ?? initial.trueRetention

  return (
    <StatCard
      testId="stat-true-retention"
      title={t('trueRetention.title')}
      help={t('trueRetention.help')}
      value={percent(retention.all.retention)}
      caption={
        retention.all.reviewed === 0
          ? t('trueRetention.none')
          : `${t('trueRetention.reviews', { count: retention.all.reviewed })} · ${t('trueRetention.since', { date: retention.from })}`
      }
    >
      <SegmentedControl
        aria-label={t('trueRetention.title')}
        value={window}
        onValueChange={setWindow}
        options={RETENTION_WINDOWS.map((name) => ({
          value: name,
          label: t(`trueRetention.windows.${name}`),
        }))}
      />
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {(['young', 'mature'] as const).map((band) => (
          <div key={band} className="flex flex-col" data-testid={`stat-true-retention-${band}`}>
            <dt className="text-muted text-xs">{t(`trueRetention.${band}`)}</dt>
            <dd className="tabular-nums">
              {percent(retention[band].retention)}
              <span className="text-muted ml-1 text-xs">
                ({retention[band].correct}/{retention[band].reviewed})
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </StatCard>
  )
}

/** §13 row 2. */
function ByLevelCard({ stats }: { stats: StatsOverview }) {
  const t = useT('statistics')
  // A level nobody reviewed this month has nothing to compare, and a row of dashes per
  // level would bury the two that do.
  const rows = stats.byLevel.filter((entry) => entry.reviewed > 0)
  const alerts = rows.filter((entry) => entry.alert).length

  return (
    <StatCard
      testId="stat-by-level"
      title={t('byLevel.title')}
      help={t('byLevel.help')}
      caption={alerts > 0 ? t('byLevel.alert', { count: alerts }) : undefined}
    >
      {rows.length === 0 ? (
        <p className="text-muted text-sm">{t('byLevel.none')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-muted text-xs">
            <tr>
              <th scope="col" className="text-left font-normal">
                {t('byLevel.level')}
              </th>
              <th scope="col" className="text-right font-normal">
                {t('byLevel.desired')}
              </th>
              <th scope="col" className="text-right font-normal">
                {t('byLevel.actual')}
              </th>
              <th scope="col" className="text-right font-normal">
                {t('byLevel.gap')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.level} data-testid={`stat-by-level-${entry.level}`}>
                <th scope="row" className="py-1 text-left font-normal">
                  {entry.level}
                </th>
                <td className="py-1 text-right tabular-nums">{percent(entry.desiredRetention)}</td>
                <td className="py-1 text-right tabular-nums">{percent(entry.trueRetention)}</td>
                <td className="py-1 text-right tabular-nums">
                  {entry.alert ? (
                    <Badge variant="incorrect" data-testid={`stat-by-level-${entry.level}-alert`}>
                      {points(entry.gap)}
                    </Badge>
                  ) : (
                    <span className="text-muted">{points(entry.gap)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </StatCard>
  )
}

/** §13 rows 3 and 4. */
function MemorizedCards({ stats }: { stats: StatsOverview }) {
  const t = useT('statistics')
  const { memorized } = stats
  const series = memorized.series.map((day) => ({
    // `MM-DD`: a 30-point axis has no room for the year, and every point is this year.
    label: day.day.slice(5),
    value: Math.round(day.memorized * 10) / 10,
  }))

  return (
    <>
      <StatCard
        testId="stat-mean-retention"
        title={t('meanRetention.title')}
        help={t('meanRetention.help')}
        value={percent(memorized.meanRetrievability)}
        caption={t('meanRetention.cards', { count: memorized.reviewCards })}
      />
      <StatCard
        testId="stat-memorized"
        title={t('memorized.title')}
        help={t('memorized.help')}
        value={t('memorized.unit', { count: Math.round(memorized.today) })}
        caption={t('memorized.chartCaption')}
      >
        <Suspense fallback={<ChartFallback />}>
          <Charts.Series
            data={series}
            caption={t('memorized.chartCaption')}
            valueHeading={t('memorized.chartValue')}
          />
        </Suspense>
      </StatCard>
    </>
  )
}

/** §13 row 5. */
function DistributionCard({ stats }: { stats: StatsOverview }) {
  const t = useT('statistics')
  const { distribution } = stats
  const [axis, setAxis] = useState<'stability' | 'difficulty'>('stability')
  const bins = distribution[axis].map((bin) => ({ label: bin.label, value: bin.count }))

  return (
    <StatCard
      testId="stat-distribution"
      title={t('distribution.title')}
      help={t('distribution.help')}
      caption={
        distribution.cards === 0
          ? t('distribution.none')
          : `${t('distribution.over21', { percent: percent(distribution.shareOver21Days) })} · ${t('distribution.over365', { percent: percent(distribution.shareOver365Days) })}`
      }
    >
      <SegmentedControl
        aria-label={t('distribution.title')}
        value={axis}
        onValueChange={setAxis}
        options={[
          { value: 'stability', label: t('distribution.stability') },
          { value: 'difficulty', label: t('distribution.difficulty') },
        ]}
      />
      <Suspense fallback={<ChartFallback />}>
        <Charts.Histogram
          data={bins}
          caption={t(`distribution.${axis}Caption`)}
          valueHeading={t('distribution.cards')}
        />
      </Suspense>
    </StatCard>
  )
}

/** §13 row 6 — sub-phase 4.3's forecast, drawn rather than recomputed. */
function ForecastCard({ stats }: { stats: StatsOverview }) {
  const t = useT('statistics')
  const { forecast } = stats
  if (forecast === null) return null

  const days = forecast.days.map((day) => ({ label: day.day.slice(5), value: day.cards }))
  const total = forecast.days.reduce((sum, day) => sum + day.cards, 0)

  return (
    <StatCard
      testId="stat-forecast"
      title={t('forecast.title')}
      help={t('forecast.help')}
      caption={
        total === 0 ? t('forecast.none') : t('forecast.backlog', { count: forecast.backlog })
      }
    >
      <Suspense fallback={<ChartFallback />}>
        <Charts.Histogram
          data={days}
          caption={t('forecast.chartCaption')}
          valueHeading={t('forecast.chartValue')}
        />
      </Suspense>
    </StatCard>
  )
}

export function StatsScreen() {
  const t = useT('statistics')
  const { data, isLoading, error, refetch } = useIpcQuery('stats.overview', {
    memorizedDays: SERIES_DAYS,
    forecastDays: FORECAST_DAYS,
  })

  if (isLoading) {
    return (
      <div data-testid="screen-statistics" className="flex flex-col gap-4 p-6 compact:p-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} className="h-48 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div data-testid="screen-statistics" className="p-6 compact:p-4">
        <ErrorState
          title={t('error.title')}
          description={error?.message ?? ''}
          retryLabel={t('error.retry')}
          onRetry={() => void refetch()}
        />
      </div>
    )
  }

  // No cards at all: every one of the six panels is a dash, and saying *why* they are empty
  // — true retention needs reviews of things you had already learned — is the useful part.
  if (data.memorized.totalCards === 0) {
    return (
      <div data-testid="screen-statistics" className="p-6 compact:p-4">
        <EmptyState title={t('empty.title')} description={t('empty.body')} />
      </div>
    )
  }

  return (
    <div
      data-testid="screen-statistics"
      className="flex flex-col gap-4 p-6 compact:gap-3 compact:p-4"
    >
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted text-sm">{t('subtitle')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <TrueRetentionCard initial={data} />
        <ByLevelCard stats={data} />
        <MemorizedCards stats={data} />
        <DistributionCard stats={data} />
        <ForecastCard stats={data} />
      </div>
    </div>
  )
}
