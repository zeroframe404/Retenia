import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface PageHeaderProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Page title, rendered as an `<h1>`. */
  title: ReactNode
  /** Optional supporting line under the title. */
  subtitle?: ReactNode
  /** Trailing controls (buttons, menus) aligned to the end of the header. */
  actions?: ReactNode
}

/** Top-of-screen title block: a title, an optional subtitle and a trailing actions
 * slot — the header every top-level screen (Library, Paths, Review, Stats…) opens with. */
export function PageHeader({ title, subtitle, actions, className, ...props }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-4', className)} {...props}>
      <div className="min-w-0">
        <h1 className="font-display text-text truncate text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="text-muted mt-1 text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
