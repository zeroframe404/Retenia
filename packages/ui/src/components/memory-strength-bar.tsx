import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export type MemoryStrengthBand = 'critical' | 'weak' | 'good' | 'strong'

export interface MemoryStrengthBarProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Retrievability, 0–1 (docs/spec/02-memory-system.md — FSRS's R, the probability of
   * recalling this item right now). */
  retrievability: number
  /** FSRS stability, in days — the S the scheduler stores next to R. Rendered beside the
   * bar when supplied; §1.3 asks for R *and* S, not R alone. */
  stability?: number
  /** Overrides the rendered stability text (defaults to `"12 d"`), the way `label`
   * overrides the percentage — the unit word is i18n's to own, not this component's. */
  stabilityLabel?: string
  /** Why this item came up today ("due", "leech", "exam on the 14th"). §1.3: the user
   * should see *why* something appeared, not just that it did. */
  dueReason?: string
  /** Optional visible label; defaults to a percentage. */
  label?: string
  /** Hide the strength-band word (e.g. "Weak") next to the bar. */
  hideBand?: boolean
  /** Translated band words. The defaults are English, and `es-AR` is the default locale,
   * so any caller inside the app is expected to pass these. */
  bandLabels?: Record<MemoryStrengthBand, string>
}

const bands = [
  { max: 0.3, key: 'critical', label: 'Critical', className: 'bg-red-500' },
  { max: 0.6, key: 'weak', label: 'Weak', className: 'bg-amber-500' },
  { max: 0.85, key: 'good', label: 'Good', className: 'bg-brand-500' },
  { max: Number.POSITIVE_INFINITY, key: 'strong', label: 'Strong', className: 'bg-teal-500' },
] as const satisfies readonly { max: number; key: MemoryStrengthBand; [k: string]: unknown }[]

function bandFor(retrievability: number) {
  // The last band's `max` is +Infinity, so `find` always matches.
  return bands.find((band) => retrievability <= band.max) as (typeof bands)[number]
}

/** Visualizes FSRS retrievability (0–1) as a labeled bar, optionally alongside stability
 * and the reason the item is due — "the scheduler is transparent"
 * (docs/spec/01-decisions.md §7.2, docs/spec/08-ux.md §1.3): the user should always see
 * how likely they are to recall an item, how durable that memory is, and why it surfaced
 * today, not just an opaque due date. */
export function MemoryStrengthBar({
  retrievability,
  stability,
  stabilityLabel,
  dueReason,
  label,
  hideBand,
  bandLabels,
  className,
  ...props
}: MemoryStrengthBarProps) {
  const clamped = Math.min(1, Math.max(0, retrievability))
  const band = bandFor(clamped)
  const percent = Math.round(clamped * 100)
  const bandText = bandLabels?.[band.key] ?? band.label
  const stabilityText =
    stabilityLabel ?? (stability === undefined ? undefined : `${formatDays(stability)} d`)

  return (
    <div className={cn('flex flex-col gap-1', className)} {...props}>
      <div className="flex items-center gap-2">
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
        {stabilityText !== undefined && (
          <span
            className="text-muted shrink-0 text-xs tabular-nums"
            data-testid="memory-strength-stability"
          >
            {stabilityText}
          </span>
        )}
        {!hideBand && <span className="text-muted w-16 shrink-0 text-xs">{bandText}</span>}
      </div>
      {dueReason && (
        <p className="text-muted text-xs" data-testid="memory-strength-due-reason">
          {dueReason}
        </p>
      )}
    </div>
  )
}

/** Sub-day stabilities are common right after a lapse, so they keep one decimal; anything
 * a day or longer reads as a whole number. */
function formatDays(days: number) {
  return days < 1 ? days.toFixed(1) : String(Math.round(days))
}
