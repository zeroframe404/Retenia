import { useId, useMemo } from 'react'
import { cn } from '../lib/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

export interface HeatmapPoint {
  /** ISO date string, e.g. `"2026-08-30"`. */
  date: string
  value: number
}

export interface HeatmapProps {
  data: HeatmapPoint[]
  weeks?: 12 | 26 | 52
  /** Formats a cell's tooltip/table text, e.g. `(p) => \`${p.value} reviews on ${p.date}\``. */
  formatTooltip?: (point: HeatmapPoint) => string
  /** Caption for the accessible `<table>` fallback (visually hidden, always in the DOM). */
  caption: string
  className?: string
}

const DAY_MS = 86_400_000

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d
}

function buildWeeks(data: HeatmapPoint[], weeks: number, today: Date): (HeatmapPoint | null)[][] {
  const byDate = new Map(data.map((p) => [p.date, p]))
  const gridStart = new Date(startOfWeek(today).getTime() - (weeks - 1) * 7 * DAY_MS)

  return Array.from({ length: weeks }, (_, weekIndex) =>
    Array.from({ length: 7 }, (_, dayIndex) => {
      const date = new Date(gridStart.getTime() + (weekIndex * 7 + dayIndex) * DAY_MS)
      const iso = date.toISOString().slice(0, 10)
      if (date > today) return null
      return byDate.get(iso) ?? { date: iso, value: 0 }
    }),
  )
}

function levelFor(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0
  const ratio = value / max
  if (ratio > 0.75) return 4
  if (ratio > 0.5) return 3
  if (ratio > 0.25) return 2
  return 1
}

const levelClasses = {
  0: 'bg-neutral-100 dark:bg-neutral-800',
  1: 'bg-brand-200 dark:bg-brand-900',
  2: 'bg-brand-400 dark:bg-brand-700',
  3: 'bg-brand-600 dark:bg-brand-500',
  4: 'bg-brand-800 dark:bg-brand-300',
} as const

const defaultFormatTooltip = (point: HeatmapPoint) => `${point.value} on ${point.date}`

/** A GitHub-style contribution calendar for `{date, value}[]` data (review counts, XP,
 * study minutes). Visual grid + tooltips for sighted mouse users, and a visually-hidden
 * `<table>` with the same data for screen readers — the grid's per-cell `title`/tooltip
 * alone would not be reliably announced. */
export function Heatmap({
  data,
  weeks = 26,
  formatTooltip = defaultFormatTooltip,
  caption,
  className,
}: HeatmapProps) {
  const tableId = useId()
  const today = useMemo(() => new Date(), [])
  const grid = useMemo(() => buildWeeks(data, weeks, today), [data, weeks, today])
  const max = useMemo(() => Math.max(1, ...data.map((p) => p.value)), [data])

  return (
    <div className={cn('inline-block', className)}>
      <div role="img" aria-labelledby={tableId} className="flex gap-[3px]">
        {grid.map((week, weekIndex) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: weeks are a fixed, ordered grid — position is the identity
          <div key={weekIndex} className="flex flex-col gap-[3px]">
            {week.map((point, dayIndex) =>
              point ? (
                <Tooltip key={point.date}>
                  <TooltipTrigger
                    render={
                      <div
                        className={cn(
                          'size-3 rounded-sm',
                          levelClasses[levelFor(point.value, max)],
                        )}
                      />
                    }
                  />
                  <TooltipContent>{formatTooltip(point)}</TooltipContent>
                </Tooltip>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: future/out-of-range cells have no date to key on
                <div key={dayIndex} className="size-3 rounded-sm bg-transparent" />
              ),
            )}
          </div>
        ))}
      </div>
      <table id={tableId} className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.date}>
              <th scope="row">{point.date}</th>
              <td>{point.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
