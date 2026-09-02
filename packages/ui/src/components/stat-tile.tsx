import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Card } from './card'

export interface StatTileProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The headline figure, e.g. `1,240` or `"87%"`. */
  value: ReactNode
  /** What the figure measures, e.g. "XP this week". */
  label: ReactNode
  /** Signed change since the previous period, e.g. `+12` or `-3.5`. Sign decides the
   * up/down/flat styling and icon; omit when there is nothing to compare against. */
  delta?: number
  /** Formats `delta` for display; defaults to a signed integer. */
  formatDelta?: (delta: number) => string
  /** A small trend visual (e.g. a `Sparkline`/mini chart) rendered under the value. */
  sparkline?: ReactNode
}

const defaultFormatDelta = (delta: number) =>
  `${delta > 0 ? '+' : ''}${Number.isInteger(delta) ? delta : delta.toFixed(1)}`

/** A single at-a-glance metric card: value, label, optional delta-vs-previous-period and
 * an optional sparkline slot — the building block of stats/dashboard screens. */
export function StatTile({
  value,
  label,
  delta,
  formatDelta = defaultFormatDelta,
  sparkline,
  className,
  ...props
}: StatTileProps) {
  const trend = delta === undefined ? undefined : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  const TrendIcon =
    trend === 'up' ? TrendingUpIcon : trend === 'down' ? TrendingDownIcon : MinusIcon

  return (
    <Card className={cn('flex flex-col gap-2 p-4', className)} {...props}>
      <span className="text-muted text-sm">{label}</span>
      <span className="font-display text-text text-3xl font-semibold">{value}</span>
      {delta !== undefined && (
        <span
          className={cn(
            'inline-flex w-fit items-center gap-1 text-xs font-medium',
            trend === 'up' && 'text-correct',
            trend === 'down' && 'text-incorrect',
            trend === 'flat' && 'text-muted',
          )}
        >
          <TrendIcon className="size-3.5" aria-hidden="true" />
          {formatDelta(delta)}
        </span>
      )}
      {sparkline && <div className="mt-1">{sparkline}</div>}
    </Card>
  )
}
