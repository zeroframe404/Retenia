import { Separator as BaseSeparator } from '@base-ui/react/separator'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: ComponentProps<typeof BaseSeparator>) {
  return (
    <BaseSeparator
      orientation={orientation}
      className={cn(
        'bg-border shrink-0',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  )
}
