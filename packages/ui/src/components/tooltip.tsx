import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export const TooltipProvider = BaseTooltip.Provider
export const Tooltip = BaseTooltip.Root
export const TooltipTrigger = BaseTooltip.Trigger

export function TooltipContent({
  className,
  sideOffset = 8,
  ...props
}: ComponentProps<typeof BaseTooltip.Popup> & { sideOffset?: number }) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner sideOffset={sideOffset} className="z-50">
        <BaseTooltip.Popup
          className={cn(
            'bg-neutral-900 text-neutral-50 dark:bg-neutral-50 dark:text-neutral-900',
            'rounded-sm px-2 py-1 text-xs shadow-soft',
            'duration-fast ease-standard',
            'data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
            'data-[ending-style]:scale-95 data-[ending-style]:opacity-0',
            className,
          )}
          {...props}
        />
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  )
}
