import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export const Tabs = BaseTabs.Root
export const TabsPanel = BaseTabs.Panel

export function TabsList({ className, ...props }: ComponentProps<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      className={cn(
        'bg-neutral-100 text-muted relative inline-flex items-center gap-1 rounded-md p-1',
        'dark:bg-neutral-800',
        className,
      )}
      {...props}
    />
  )
}

export function TabsTab({ className, ...props }: ComponentProps<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      className={cn(
        'relative z-10 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors duration-fast ease-standard',
        'data-[selected]:text-text text-muted',
        className,
      )}
      {...props}
    />
  )
}

export function TabsIndicator({ className, ...props }: ComponentProps<typeof BaseTabs.Indicator>) {
  return (
    <BaseTabs.Indicator
      className={cn(
        'bg-surface absolute top-1 left-0 z-0 h-[calc(100%-0.5rem)] rounded-sm shadow-soft',
        'transition-[transform,width] duration-base ease-standard',
        className,
      )}
      {...props}
    />
  )
}
