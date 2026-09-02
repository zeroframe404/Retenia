import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Badge, type BadgeProps } from './badge'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

export interface CostLineItem {
  label: ReactNode
  amountUsd: number
}

export interface CostBadgeProps extends Omit<BadgeProps, 'children'> {
  /** Total cost in USD, e.g. `0.12`. Always rendered as an approximation ("≈ USD 0.12") —
   * provider pricing is never exact enough to present as a precise figure. */
  amountUsd: number
  /** Per-call breakdown shown in the tooltip (e.g. one line per provider call that made
   * up this generation). Omit for a plain badge with no tooltip. */
  breakdown?: CostLineItem[]
  /** Number of decimal places for each USD figure. */
  decimals?: number
}

function formatUsd(amount: number, decimals: number) {
  return `USD ${amount.toFixed(decimals)}`
}

/** Shows an approximate AI cost ("≈ USD 0.12") with an optional per-call tooltip
 * breakdown — the "visible per-call cost" principle (docs/spec/01-decisions.md §7.6). */
export function CostBadge({
  amountUsd,
  breakdown,
  decimals = 2,
  variant = 'neutral',
  className,
  ...props
}: CostBadgeProps) {
  const label = `≈ ${formatUsd(amountUsd, decimals)}`

  if (!breakdown || breakdown.length === 0) {
    return (
      <Badge variant={variant} className={cn('tabular-nums', className)} {...props}>
        {label}
      </Badge>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={<Badge variant={variant} className={cn('tabular-nums', className)} {...props} />}
      >
        {label}
      </TooltipTrigger>
      <TooltipContent>
        <ul className="flex flex-col gap-0.5">
          {breakdown.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: breakdown order is stable within one render, labels alone are not guaranteed unique
            <li key={index} className="flex items-center justify-between gap-3">
              <span>{item.label}</span>
              <span className="tabular-nums">{formatUsd(item.amountUsd, decimals)}</span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}
