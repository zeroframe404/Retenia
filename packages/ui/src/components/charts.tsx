import type { ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '../lib/cn'

/**
 * The two chart shapes the statistics screen needs
 * (`docs/spec/02-memory-system.md` §13): a daily series and a histogram.
 *
 * Kept as a **separate module rather than part of the barrel's hot path** so the renderer
 * can `lazy()` it into its own chunk — recharts pulls in a slice of d3, and no screen but
 * this one draws a chart.
 *
 * Two things every chart here does, both borrowed from `Heatmap`:
 *
 * - **A visually-hidden `<table>` with the same numbers.** An SVG chart is a picture to a
 *   screen reader whatever ARIA is sprinkled on it; the table is the real content, and
 *   `docs/spec/08-ux.md`'s accessibility pass treats it as such.
 * - **Colours from the theme tokens, not from props.** `currentColor` and the `--color-*`
 *   custom properties follow dark mode without the chart knowing dark mode exists.
 */

export interface ChartPoint {
  /** The category or day label — an axis tick, and the table's row header. */
  label: string
  value: number
}

interface ChartFrameProps {
  data: readonly ChartPoint[]
  caption: string
  /** Column heading for the value column of the accessible table. */
  valueHeading: string
  format?: (value: number) => string
  className?: string
  children: ReactNode
}

const defaultFormat = (value: number) => String(Math.round(value * 100) / 100)

/** The shared shell: a sized box for the SVG, plus the table that carries the real data. */
function ChartFrame({
  data,
  caption,
  valueHeading,
  format = defaultFormat,
  className,
  children,
}: ChartFrameProps) {
  return (
    <figure className={cn('m-0 flex flex-col gap-2', className)}>
      {/* `aria-hidden`: the numbers live in the table below, and a screen reader that walked
          the SVG would read a few hundred unlabelled path elements instead. */}
      <div aria-hidden="true" className="h-40 w-full compact:h-32">
        {children}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{caption}</th>
            <th scope="col">{valueHeading}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.label}>
              <th scope="row">{point.label}</th>
              <td>{format(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

const AXIS = {
  stroke: 'currentColor',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const

/** Recharts styles its own tooltip inline; these keep it on the design tokens. */
const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: '0.5rem',
    fontSize: '0.75rem',
    color: 'var(--color-text)',
  },
  labelStyle: { color: 'var(--color-muted)' },
  cursor: { fill: 'var(--color-border)', fillOpacity: 0.3 },
} as const

export interface SeriesChartProps extends Omit<ChartFrameProps, 'children'> {
  /** Drawn under the line. Off for a series that is more read than admired. */
  filled?: boolean
}

/**
 * A daily series — §13's "memorized knowledge and its time series".
 *
 * An area rather than a line because the quantity is a *total* (`Σ R`, the expected number
 * of recallable items): the filled region is the knowledge, and its shrinking is the point
 * the chart exists to make.
 */
export function SeriesChart({ data, filled = true, ...frame }: SeriesChartProps) {
  return (
    <ChartFrame data={data} {...frame}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={[...data]} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="retenia-series-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" {...AXIS} minTickGap={24} />
          <YAxis {...AXIS} width={36} />
          <RechartsTooltip {...TOOLTIP_STYLE} />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--color-brand-500)"
            strokeWidth={2}
            fill={filled ? 'url(#retenia-series-fill)' : 'none'}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}

export type HistogramChartProps = Omit<ChartFrameProps, 'children'>

/** A histogram — §13's stability and difficulty distributions. */
export function HistogramChart({ data, ...frame }: HistogramChartProps) {
  return (
    <ChartFrame data={data} {...frame}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={[...data]} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" {...AXIS} interval={0} />
          <YAxis {...AXIS} width={32} allowDecimals={false} />
          <RechartsTooltip {...TOOLTIP_STYLE} />
          <Bar
            dataKey="value"
            fill="var(--color-brand-500)"
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  )
}
