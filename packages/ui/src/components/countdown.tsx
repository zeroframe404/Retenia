import type { ComponentProps } from 'react'
import { useEffect, useState } from 'react'
import { cn } from '../lib/cn'

export interface CountdownProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** The target instant, e.g. an exam date (docs/spec/02-memory-system.md exam mode). */
  target: Date
  /** Formats the remaining `Date` (fixed at the Unix epoch, so its fields are exactly the
   * duration) into the visible string. Defaults to "Nd Hh Mm" (or "Hh Mm" once under a
   * day, "Mm Ss" once under an hour), and "Due" once the target has passed. */
  format?: (remaining: Duration) => string
  /** How often to recompute, in ms. Defaults to 1000; use 60000 for day/hour-granularity
   * countdowns to avoid needless re-renders. */
  intervalMs?: number
}

export interface Duration {
  totalMs: number
  days: number
  hours: number
  minutes: number
  seconds: number
}

function durationUntil(target: Date, now: Date): Duration {
  const totalMs = Math.max(0, target.getTime() - now.getTime())
  const totalSeconds = Math.floor(totalMs / 1000)
  return {
    totalMs,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  }
}

function defaultFormat(d: Duration): string {
  if (d.totalMs <= 0) return 'Due'
  if (d.days > 0) return `${d.days}d ${d.hours}h`
  if (d.hours > 0) return `${d.hours}h ${d.minutes}m`
  return `${d.minutes}m ${d.seconds}s`
}

/** Live "time until" readout for a dated exam or a study-plan deadline. Re-renders on
 * `intervalMs` — pass the fixed `format` if the caller only needs day/hour granularity so
 * the default 1s tick doesn't churn the DOM for nothing. */
export function Countdown({
  target,
  format = defaultFormat,
  intervalMs = 1000,
  className,
  ...props
}: CountdownProps) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  const remaining = durationUntil(target, now)

  return (
    <span
      className={cn('tabular-nums', remaining.totalMs <= 0 && 'text-incorrect', className)}
      {...props}
    >
      {format(remaining)}
    </span>
  )
}
