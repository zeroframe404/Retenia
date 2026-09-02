import { Switch as BaseSwitch } from '@base-ui/react/switch'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export function Switch({ className, ...props }: ComponentProps<typeof BaseSwitch.Root>) {
  return (
    <BaseSwitch.Root
      className={cn(
        'bg-neutral-300 data-[checked]:bg-brand-600 dark:bg-neutral-700',
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full',
        'transition-colors duration-fast ease-standard',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          'block size-4 translate-x-1 rounded-full bg-white shadow-soft',
          'transition-transform duration-fast ease-standard',
          'data-[checked]:translate-x-5',
        )}
      />
    </BaseSwitch.Root>
  )
}
