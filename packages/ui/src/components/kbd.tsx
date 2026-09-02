import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

/** A keyboard shortcut hint (Ctrl+K command palette, review-grading 1–4, Space to reveal —
 * docs/spec/08-ux.md §1 "keyboard first"). */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'bg-neutral-100 border-border inline-flex h-5 min-w-5 items-center justify-center rounded border px-1.5',
        'font-mono text-xs',
        // `text-neutral-600`, not `text-muted` (`neutral-500`): against this component's own
        // `bg-neutral-100` (not the page `bg`/`surface` `text-muted` is calibrated against)
        // `neutral-500` only reaches 4.32:1, under WCAG 2.2 AA's 4.5:1 text floor — caught by
        // the axe-core E2E pass (`apps/desktop/e2e/accessibility.spec.ts`). `dark:text-neutral-400`
        // is unchanged from `text-muted`'s dark value, which already cleared 4.5:1 there.
        'text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
        className,
      )}
      {...props}
    />
  )
}
