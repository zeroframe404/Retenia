import type { KeyboardEvent, ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface SegmentedControlOption<Value extends string> {
  value: Value
  label: ReactNode
  disabled?: boolean
}

export interface SegmentedControlProps<Value extends string> {
  options: SegmentedControlOption<Value>[]
  value: Value
  onValueChange: (value: Value) => void
  /** Accessible name for the group (e.g. "Density"). */
  'aria-label': string
  className?: string
}

/** A single-choice control styled as a row of joined buttons — density, view mode,
 * grading strictness, etc. `role="radiogroup"` semantics with roving-tabindex arrow-key
 * navigation, same interaction model as a native radio group. */
export function SegmentedControl<Value extends string>({
  options,
  value,
  onValueChange,
  className,
  ...props
}: SegmentedControlProps<Value>) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const enabled = options.filter((o) => !o.disabled)
    const currentIndex = enabled.findIndex((o) => o.value === value)
    if (currentIndex === -1) return

    let nextIndex: number | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % enabled.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + enabled.length) % enabled.length
    }
    const next = nextIndex === undefined ? undefined : enabled[nextIndex]
    if (next) {
      event.preventDefault()
      onValueChange(next.value)
    }
  }

  return (
    <div
      role="radiogroup"
      className={cn(
        'bg-neutral-100 text-muted inline-flex items-center gap-1 rounded-md p-1',
        'dark:bg-neutral-800',
        className,
      )}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          // biome-ignore lint/a11y/useSemanticElements: a native <input type="radio"> can't be styled as a segmented button group without losing its own focus/label semantics; this replicates radio behavior with explicit ARIA and keyboard handling instead.
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'rounded-sm px-3 py-1.5 text-sm font-medium transition-colors duration-fast ease-standard',
              'disabled:pointer-events-none disabled:opacity-50',
              selected ? 'bg-surface text-text shadow-soft' : 'hover:text-text text-muted',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
