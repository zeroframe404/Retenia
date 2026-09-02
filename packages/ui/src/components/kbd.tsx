import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

/** A keyboard shortcut hint (Ctrl+K command palette, review-grading 1–4, Space to reveal —
 * docs/spec/08-ux.md §1 "keyboard first"). */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'bg-neutral-100 text-muted border-border inline-flex h-5 min-w-5 items-center justify-center rounded border px-1.5',
        'font-mono text-xs',
        'dark:bg-neutral-800',
        className,
      )}
      {...props}
    />
  )
}
