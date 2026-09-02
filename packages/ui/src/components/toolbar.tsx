import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface ToolbarProps extends ComponentProps<'div'> {
  /** Controls aligned to the start (left in LTR). */
  start?: ReactNode
  /** Controls aligned to the end (right in LTR). */
  end?: ReactNode
}

/** A horizontal action bar — e.g. above the PDF reader or the notes editor: view
 * controls on the start, contextual actions on the end. `children` render between the
 * two, for a center group (search box, page indicator). */
export function Toolbar({ start, end, children, className, ...props }: ToolbarProps) {
  return (
    <div
      role="toolbar"
      className={cn(
        'border-border bg-surface flex h-11 shrink-0 items-center gap-2 border-b px-2',
        className,
      )}
      {...props}
    >
      {start && <div className="flex items-center gap-1">{start}</div>}
      {children && <div className="flex flex-1 items-center justify-center gap-1">{children}</div>}
      {end && <div className="ml-auto flex items-center gap-1">{end}</div>}
    </div>
  )
}
