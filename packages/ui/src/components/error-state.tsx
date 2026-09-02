import { AlertTriangleIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Button } from './button'

export interface ErrorStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: ReactNode
  description?: ReactNode
  /** Label for the retry button; omit (along with `onRetry`) when there is nothing to retry. */
  retryLabel?: ReactNode
  onRetry?: () => void
}

/** Failure placeholder — a screen/panel/section that could not load. Uses
 * `role="alert"` so assistive tech announces it as soon as it mounts. */
export function ErrorState({
  title,
  description,
  retryLabel,
  onRetry,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'border-incorrect/30 flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center',
        className,
      )}
      {...props}
    >
      <AlertTriangleIcon aria-hidden="true" className="text-incorrect size-10" />
      <p className="font-display text-text text-base font-semibold">{title}</p>
      {description && <p className="text-muted max-w-sm text-sm">{description}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          {retryLabel ?? 'Retry'}
        </Button>
      )}
    </div>
  )
}
