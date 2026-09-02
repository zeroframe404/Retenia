import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'border-border bg-surface text-text placeholder:text-muted flex h-10 w-full rounded-md border px-3 py-2 text-sm',
        'transition-colors duration-fast ease-standard',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
