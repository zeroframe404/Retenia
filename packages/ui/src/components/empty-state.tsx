import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Decorative icon or illustration, e.g. a `lucide-react` icon. Hidden from assistive
   * tech — `title`/`description` already carry the meaning. */
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** A call to action, typically a `Button` (e.g. "Add source"). */
  action?: ReactNode
}

/** Placeholder for a list/screen with nothing in it yet — a neutral icon, a short
 * explanation and an optional next action. Pair with `ErrorState` for the failure case. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center',
        className,
      )}
      {...props}
    >
      {icon && (
        <div aria-hidden="true" className="text-muted [&_svg]:size-10">
          {icon}
        </div>
      )}
      <p className="font-display text-text text-base font-semibold">{title}</p>
      {description && <p className="text-muted max-w-sm text-sm">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
