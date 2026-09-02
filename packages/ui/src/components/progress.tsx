import { Progress as BaseProgress } from '@base-ui/react/progress'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export const Progress = BaseProgress.Root
export const ProgressLabel = BaseProgress.Label
export const ProgressValue = BaseProgress.Value

export function ProgressTrack({ className, ...props }: ComponentProps<typeof BaseProgress.Track>) {
  return (
    <BaseProgress.Track
      className={cn(
        'bg-neutral-200 dark:bg-neutral-800 relative h-2 overflow-hidden rounded-full',
        className,
      )}
      {...props}
    />
  )
}

export function ProgressIndicator({
  className,
  ...props
}: ComponentProps<typeof BaseProgress.Indicator>) {
  return (
    <BaseProgress.Indicator
      className={cn(
        'bg-brand-600 h-full rounded-full transition-[width] duration-base ease-standard',
        className,
      )}
      {...props}
    />
  )
}

export interface ProgressRingProps extends ComponentProps<'svg'> {
  /** 0–100. */
  value: number
  size?: number
  strokeWidth?: number
  label?: string
}

/** A circular progress indicator — Base UI has no ring primitive, so this is a plain SVG
 * with the same `role="progressbar"` semantics `Progress.Root` uses. */
export function ProgressRing({
  value,
  size = 48,
  strokeWidth = 5,
  label,
  className,
  ...props
}: ProgressRingProps) {
  const clamped = Math.min(100, Math.max(0, value))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)

  return (
    <svg
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('-rotate-90', className)}
      {...props}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        className="stroke-neutral-200 dark:stroke-neutral-800"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="stroke-brand-600 transition-[stroke-dashoffset] duration-base ease-standard"
      />
    </svg>
  )
}
