import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { XIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'
import { IconButton } from './button'

export const Sheet = BaseDialog.Root
export const SheetTrigger = BaseDialog.Trigger
export const SheetClose = BaseDialog.Close

const sheetSide = {
  right:
    'inset-y-0 right-0 h-full w-full max-w-sm border-l data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full',
  left: 'inset-y-0 left-0 h-full w-full max-w-sm border-r data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full',
  top: 'inset-x-0 top-0 w-full border-b data-[starting-style]:-translate-y-full data-[ending-style]:-translate-y-full',
  bottom:
    'inset-x-0 bottom-0 w-full border-t data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full',
} as const

export interface SheetContentProps extends ComponentProps<typeof BaseDialog.Popup> {
  side?: keyof typeof sheetSide
  showClose?: boolean
}

/** A `Dialog` variant anchored to a viewport edge — the pattern shadcn/ui calls "Sheet".
 * Same Base UI `Dialog` primitive as `dialog.tsx`, only the popup's position/motion differ. */
export function SheetContent({
  className,
  children,
  side = 'right',
  showClose = true,
  ...props
}: SheetContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop
        className={cn(
          'fixed inset-0 z-50 bg-black/40 duration-base ease-standard',
          'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
        )}
      />
      <BaseDialog.Popup
        className={cn(
          'bg-surface border-border text-text fixed z-50 p-6 shadow-soft',
          'duration-base ease-standard',
          sheetSide[side],
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <BaseDialog.Close
            render={<IconButton variant="ghost" size="sm" aria-label="Close" />}
            className="absolute top-3 right-3"
          >
            <XIcon />
          </BaseDialog.Close>
        )}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  )
}

export function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mb-4 flex flex-col gap-1.5', className)} {...props} />
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof BaseDialog.Title>) {
  return (
    <BaseDialog.Title className={cn('font-display text-lg font-semibold', className)} {...props} />
  )
}

export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof BaseDialog.Description>) {
  return <BaseDialog.Description className={cn('text-muted text-sm', className)} {...props} />
}
