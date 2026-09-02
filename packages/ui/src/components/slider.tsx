import { Slider as BaseSlider } from '@base-ui/react/slider'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export const Slider = BaseSlider.Root
export const SliderValue = BaseSlider.Value

export function SliderControl({ className, ...props }: ComponentProps<typeof BaseSlider.Control>) {
  return (
    <BaseSlider.Control
      className={cn('relative flex h-6 w-full items-center', className)}
      {...props}
    />
  )
}

export function SliderTrack({ className, ...props }: ComponentProps<typeof BaseSlider.Track>) {
  return (
    <BaseSlider.Track
      className={cn(
        'bg-neutral-200 dark:bg-neutral-800 relative h-1.5 w-full grow overflow-hidden rounded-full',
        className,
      )}
      {...props}
    />
  )
}

export function SliderIndicator({
  className,
  ...props
}: ComponentProps<typeof BaseSlider.Indicator>) {
  return (
    <BaseSlider.Indicator
      className={cn('bg-brand-600 absolute h-full rounded-full', className)}
      {...props}
    />
  )
}

/** `size-6` (24px) meets WCAG 2.2 SC 2.5.8 Target Size (Minimum) on its own, with no need
 * to lean on the "spacing" exception the previous `size-4` thumb depended on. */
export function SliderThumb({ className, ...props }: ComponentProps<typeof BaseSlider.Thumb>) {
  return (
    <BaseSlider.Thumb
      className={cn(
        'border-brand-600 bg-surface block size-6 rounded-full border-2 shadow-soft',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        className,
      )}
      {...props}
    />
  )
}
