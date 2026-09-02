import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        brand: 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100',
        neutral: 'bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100',
        correct: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-100',
        incorrect: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
        xp: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100',
        outline: 'text-text border border-border',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
)

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
