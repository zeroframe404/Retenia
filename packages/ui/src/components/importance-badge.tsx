import { cva, type VariantProps } from 'class-variance-authority'
import { AlertOctagonIcon, ArchiveIcon, FlameIcon, PauseIcon, ShieldIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

/** The 5 importance levels (docs/spec/02-memory-system.md), in urgency order. */
export const IMPORTANCE_LEVELS = ['urgent', 'high', 'normal', 'maintenance', 'paused'] as const
export type ImportanceLevel = (typeof IMPORTANCE_LEVELS)[number]

const importanceIcons: Record<ImportanceLevel, typeof FlameIcon> = {
  urgent: AlertOctagonIcon,
  high: FlameIcon,
  normal: ShieldIcon,
  maintenance: ArchiveIcon,
  paused: PauseIcon,
}

export const importanceBadgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium [&_svg]:size-3.5',
  {
    variants: {
      level: {
        urgent: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
        high: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100',
        normal: 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100',
        maintenance: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-100',
        paused: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
      },
    },
  },
)

export interface ImportanceBadgeProps
  extends Omit<ComponentProps<'span'>, 'children'>,
    VariantProps<typeof importanceBadgeVariants> {
  level: ImportanceLevel
  /** Display label; defaults to the capitalized level (`"Urgent"`, `"High"`, …). Pass the
   * i18n-translated string in the app. */
  label?: string
}

const defaultLabels: Record<ImportanceLevel, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  maintenance: 'Maintenance',
  paused: 'Paused',
}

/** A per-item importance level (docs/spec/02-memory-system.md): drives desired
 * retention, review ordering and auto-postpone priority. Distinct color + icon per
 * level so it reads at a glance, never color alone. */
export function ImportanceBadge({ level, label, className, ...props }: ImportanceBadgeProps) {
  const Icon = importanceIcons[level]
  return (
    <span className={cn(importanceBadgeVariants({ level }), className)} {...props}>
      <Icon aria-hidden="true" />
      {label ?? defaultLabels[level]}
    </span>
  )
}
