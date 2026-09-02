import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export function ScrollArea({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseScrollArea.Root>) {
  return (
    <BaseScrollArea.Root className={cn('relative overflow-hidden', className)} {...props}>
      <BaseScrollArea.Viewport className="size-full">
        <BaseScrollArea.Content>{children}</BaseScrollArea.Content>
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar
        orientation="vertical"
        className="flex w-2.5 touch-none p-0.5 select-none"
      >
        <BaseScrollArea.Thumb className="bg-neutral-300 dark:bg-neutral-700 relative flex-1 rounded-full" />
      </BaseScrollArea.Scrollbar>
      <BaseScrollArea.Scrollbar
        orientation="horizontal"
        className="flex h-2.5 touch-none p-0.5 select-none"
      >
        <BaseScrollArea.Thumb className="bg-neutral-300 dark:bg-neutral-700 relative flex-1 rounded-full" />
      </BaseScrollArea.Scrollbar>
      <BaseScrollArea.Corner />
    </BaseScrollArea.Root>
  )
}
