import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export interface MemoryStrengthBarProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Retrievability, 0–1 (docs/spec/02-memory-system.md — FSRS's R, the probability of
   * recalling this item right now). */
  retrievability: number
  /** Optional visible label; defaults to a percentage. */
  label?: string
  /** Hide the strength-band word (e.g. "Weak") next to the bar. */
  hideBand?: boolean
}

const bands = [
  { max: 0.3, key: 'critical', label: 'Critical', className: 'bg-red-500' },
  { max: 0.6, key: 'weak', label: 'Weak', className: 'bg-amber-500' },
  { max: 0.85, key: 'good', label: 'Good', className: 'bg-brand-500' },
  { max: Number.POSITIVE_INFINITY, key: 'strong', label: 'Strong', className: 'bg-teal-500' },
] as const

function bandFor(retrievability: number) {
  // The last band's `max` is +Infinity, so `find` always matches.
  return bands.find((band) => retrievability <= band.max) as (typeof bands)[number]
}

/** Visualizes FSRS retrievability (0–1) as a labeled bar — "the scheduler is
 * transparent" (docs/spec/01-decisions.md §7.2): the user should always see roughly how
 * likely they are to recall an item right now, not just an opaque due date. */
export function MemoryStrengthBar({
  retrievability,
  label,
  hideBand,
  className,
  ...props
}: MemoryStrengthBarProps) {
  const clamped = Math.min(1, Math.max(0, retrievability))
  const band = bandFor(clamped)
  const percent = Math.round(clamped * 100)

  return (
    <div className={cn('flex items-center gap-2', className)} {...props}>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Memory strength'}
        className="bg-neutral-200 dark:bg-neutral-800 h-2 min-w-16 flex-1 overflow-hidden rounded-full"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-base ease-standard',
            band.className,
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-muted w-10 shrink-0 text-right text-xs tabular-nums">
        {label ?? `${percent}%`}
      </span>
      {!hideBand && <span className="text-muted w-16 shrink-0 text-xs">{band.label}</span>}
    </div>
  )
}
