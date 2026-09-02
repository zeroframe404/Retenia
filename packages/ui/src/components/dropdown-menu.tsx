import { Menu } from '@base-ui/react/menu'
import { CheckIcon, ChevronRightIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger
export const DropdownMenuGroup = Menu.Group
export const DropdownMenuGroupLabel = Menu.GroupLabel
export const DropdownMenuSub = Menu.SubmenuRoot
export const DropdownMenuSubTrigger = Menu.SubmenuTrigger
export const DropdownMenuRadioGroup = Menu.RadioGroup

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Menu.Popup> & { sideOffset?: number }) {
  return (
    <Menu.Portal>
      <Menu.Positioner sideOffset={sideOffset} className="z-50">
        <Menu.Popup
          className={cn(
            'bg-surface border-border text-text min-w-40 rounded-md border p-1 shadow-soft',
            'duration-fast ease-standard',
            'data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
            'data-[ending-style]:scale-95 data-[ending-style]:opacity-0',
            className,
          )}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  )
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      className={cn(
        'flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none',
        'data-[highlighted]:bg-brand-50 data-[highlighted]:text-brand-900',
        'dark:data-[highlighted]:bg-brand-900 dark:data-[highlighted]:text-brand-50',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem
      className={cn(
        'flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-none select-none',
        'data-[highlighted]:bg-brand-50 data-[highlighted]:text-brand-900',
        'dark:data-[highlighted]:bg-brand-900 dark:data-[highlighted]:text-brand-50',
        className,
      )}
      {...props}
    >
      <Menu.CheckboxItemIndicator className="absolute left-2 inline-flex items-center">
        <CheckIcon className="size-4" />
      </Menu.CheckboxItemIndicator>
      {children}
    </Menu.CheckboxItem>
  )
}

export function DropdownMenuSubTriggerContent({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.SubmenuTrigger>) {
  return (
    <Menu.SubmenuTrigger
      className={cn(
        'flex cursor-default items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none',
        'data-[highlighted]:bg-brand-50 data-[highlighted]:text-brand-900',
        'dark:data-[highlighted]:bg-brand-900 dark:data-[highlighted]:text-brand-50',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="size-4" />
    </Menu.SubmenuTrigger>
  )
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<'hr'>) {
  return <hr className={cn('bg-border -mx-1 my-1 h-px border-0', className)} {...props} />
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.GroupLabel>) {
  return (
    <Menu.GroupLabel
      className={cn('text-muted px-2 py-1.5 text-xs font-medium', className)}
      {...props}
    />
  )
}
