import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium',
    'transition-colors duration-fast ease-standard',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
    'disabled:pointer-events-none disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        primary: 'bg-brand-600 text-white shadow-soft hover:bg-brand-700',
        secondary:
          'bg-neutral-100 text-neutral-900 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-50 dark:hover:bg-neutral-700',
        outline:
          'border border-border bg-transparent text-text hover:bg-neutral-100 dark:hover:bg-neutral-800',
        ghost: 'bg-transparent text-text hover:bg-neutral-100 dark:hover:bg-neutral-800',
        destructive: 'bg-red-600 text-white shadow-soft hover:bg-red-700',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4',
        lg: 'h-12 px-6 text-base',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the given element/component instead of a `<button>`, keeping the button's
   * styles and behavior (Base UI's `useRender` merge-props pattern — e.g. `render: <a href="/x" />`
   * for a link styled as a button). */
  render?: useRender.RenderProp
}

/** Primary interactive control. `render` swaps the underlying element for e.g. a router
 * `<Link>`, exactly like shadcn/ui's `asChild` but via Base UI's `useRender`. */
export function Button({ className, variant, size, render, ...props }: ButtonProps) {
  return useRender({
    render: render ?? <button type="button" />,
    props: {
      ...props,
      className: cn(buttonVariants({ variant, size }), className),
    },
  })
}

export interface IconButtonProps
  extends ComponentProps<'button'>,
    Pick<VariantProps<typeof buttonVariants>, 'variant'> {
  size?: 'sm' | 'md' | 'lg'
  /** Required: an icon-only button must still be announced to assistive tech. */
  'aria-label': string
  render?: useRender.RenderProp
}

const iconButtonSizes = {
  sm: 'size-8',
  md: 'size-10',
  lg: 'size-12',
} as const

/** A square, icon-only `Button` — always requires `aria-label` since there is no visible
 * text for a screen reader to announce (docs/spec/08-ux.md §1 accessibility). */
export function IconButton({ className, variant, size = 'md', render, ...props }: IconButtonProps) {
  return useRender({
    render: render ?? <button type="button" />,
    props: {
      ...props,
      className: cn(buttonVariants({ variant }), iconButtonSizes[size], 'p-0', className),
    },
  })
}
