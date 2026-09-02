import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { useCallback, useRef, useState } from 'react'
import { cn } from '../lib/cn'

export interface SplitPaneProps {
  start: ReactNode
  end: ReactNode
  direction?: 'horizontal' | 'vertical'
  /** Initial size of the `start` pane, as a percent of the container (0–100). */
  defaultSize?: number
  minSize?: number
  maxSize?: number
  /** Accessible name for the resize handle (e.g. "Resize source/notes split"). */
  'aria-label': string
  className?: string
}

/** Two panes divided by a draggable handle — the PDF reader/notes editor split, the
 * source viewer/tutor split. Keyboard-resizable via arrow keys on the handle
 * (`role="separator"`), same as a native resizable pane. */
export function SplitPane({
  start,
  end,
  direction = 'horizontal',
  defaultSize = 50,
  minSize = 15,
  maxSize = 85,
  className,
  ...props
}: SplitPaneProps) {
  const [size, setSize] = useState(defaultSize)
  const containerRef = useRef<HTMLDivElement>(null)
  const isHorizontal = direction === 'horizontal'

  const clamp = useCallback(
    (value: number) => Math.min(maxSize, Math.max(minSize, value)),
    [minSize, maxSize],
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const percent = isHorizontal
        ? ((event.clientX - rect.left) / rect.width) * 100
        : ((event.clientY - rect.top) / rect.height) * 100
      setSize(clamp(percent))
    },
    [isHorizontal, clamp],
  )

  const startDragging = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      function handlePointerUp() {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
      }
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    },
    [handlePointerMove],
  )

  function handleKeyDown(event: ReactKeyboardEvent) {
    const step = 2
    if (event.key === (isHorizontal ? 'ArrowLeft' : 'ArrowUp')) {
      event.preventDefault()
      setSize((prev) => clamp(prev - step))
    } else if (event.key === (isHorizontal ? 'ArrowRight' : 'ArrowDown')) {
      event.preventDefault()
      setSize((prev) => clamp(prev + step))
    }
  }

  return (
    <div
      ref={containerRef}
      className={cn('flex h-full w-full', isHorizontal ? 'flex-row' : 'flex-col', className)}
    >
      <div
        className="min-h-0 min-w-0 overflow-auto"
        style={{ [isHorizontal ? 'width' : 'height']: `${size}%` }}
      >
        {start}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a native <hr> isn't focusable or draggable — this handle needs pointer + arrow-key resizing, which only a role="separator" with aria-value* on a real interactive element supports. */}
      <div
        role="separator"
        aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(size)}
        aria-valuemin={minSize}
        aria-valuemax={maxSize}
        tabIndex={0}
        onPointerDown={startDragging}
        onKeyDown={handleKeyDown}
        className={cn(
          // WCAG 2.2 SC 2.5.8 Target Size (Minimum): the handle *looks* like a 1px rule but
          // has to be grabbable, so the element itself is 24px across the resize axis and
          // transparent, with the visible hairline drawn by a centered `before:` pseudo-
          // element. Sizing the element itself (rather than overhanging the panes with a
          // negative-inset pseudo-element) keeps the grab zone from swallowing clicks on
          // whatever the adjacent panes render.
          'relative shrink-0 bg-transparent outline-none',
          "before:absolute before:bg-border before:content-[''] before:transition-colors before:duration-fast before:ease-standard",
          'hover:before:bg-brand-500 focus-visible:before:bg-brand-500',
          isHorizontal
            ? 'w-6 cursor-col-resize before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2'
            : 'h-6 cursor-row-resize before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2',
        )}
        {...props}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">{end}</div>
    </div>
  )
}
