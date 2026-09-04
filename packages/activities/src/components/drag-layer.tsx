import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { cn } from '@retenia/ui'
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useActivity } from '../host/activity-context'

/**
 * The drag-and-drop layer every placement family shares (`cloze` word banks, `pairs`,
 * `categorize`), and — the part §9 actually mandates — **its keyboard alternative**: *"a keyboard
 * alternative for every drag-and-drop (as Rise/H5P require)"*.
 *
 * Two input paths, one model:
 *
 * - **Pointer.** dnd-kit's `PointerSensor`: pick up and drop with the mouse or a finger.
 * - **Select then place.** Every draggable is a real `<button>` with `aria-pressed`: Enter picks it
 *   up. While something is held, the arrow keys walk the drop zones (focus follows, so a screen
 *   reader reads each one out), Enter places it there and Escape puts it back down. Every zone
 *   also grows a real "place here" button, so Tab-then-Enter works with no arrow keys at all.
 *
 * dnd-kit's own `KeyboardSensor` is deliberately **not** installed. Its activator swallows Enter
 * and Space on the draggable to start a synthetic drag, which would take those keys away from the
 * buttons above and leave the keyboard path depending on dnd-kit's coordinate maths — the thing
 * that has no meaning to a screen-reader user in the first place. One keyboard model, ours, and it
 * is the one the tests drive.
 */

export interface PlacementContextValue {
  /** The item currently picked up, by either path. */
  pickedId: string | null
  pick: (itemId: string | null) => void
  place: (zoneId: string) => void
  /** The zone the arrow keys are currently on, while an item is held. */
  targetZoneId: string | null
  registerZone: (zoneId: string) => () => void
  disabled: boolean
}

const PlacementContext = createContext<PlacementContextValue | null>(null)

export function usePlacement(): PlacementContextValue {
  const value = useContext(PlacementContext)
  if (value === null) throw new Error('usePlacement must be used inside <DragLayer/>')
  return value
}

export interface DragLayerProps {
  /** Called with the placement, whichever input path produced it. */
  onPlace: (itemId: string, zoneId: string) => void
  /** Rendered inside `DragOverlay` while a pointer drag is in flight. */
  renderDragged?: (itemId: string) => ReactNode
  children: ReactNode
}

const NEXT_KEYS = new Set(['ArrowDown', 'ArrowRight'])
const PREVIOUS_KEYS = new Set(['ArrowUp', 'ArrowLeft'])

export function DragLayer({ onPlace, renderDragged, children }: DragLayerProps) {
  const { locked } = useActivity()
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [targetZoneId, setTargetZoneId] = useState<string | null>(null)
  const zonesRef = useRef<string[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const previouslyPicked = useRef<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor))

  // Zones register in mount order, which is DOM order for every family here, so the arrow keys
  // walk them the way they read.
  const registerZone = useCallback((zoneId: string) => {
    zonesRef.current = [...zonesRef.current, zoneId]
    return () => {
      zonesRef.current = zonesRef.current.filter((candidate) => candidate !== zoneId)
    }
  }, [])

  const pick = useCallback((itemId: string | null) => {
    setPickedId((current) => (current === itemId ? null : itemId))
  }, [])

  /** Moves focus onto a zone's "place here" button, so its name is announced as it is reached. */
  const focusZone = useCallback((zoneId: string) => {
    rootRef.current?.querySelector<HTMLElement>(`[data-place-zone="${zoneId}"]`)?.focus()
  }, [])

  /**
   * Picking something up parks the cursor on the first zone and moves focus there, so the zone's
   * name is announced and Enter drops straight away.
   *
   * This is an effect rather than part of `pick` for two reasons: the "place here" button only
   * exists from the render that follows the pick-up, and — the one that bit — a `setState` updater
   * must be pure. Nesting `setTargetZoneId` inside the `setPickedId` updater made the cursor reset
   * an ordering-dependent side effect, which is not something to leave in a component whose whole
   * job is keyboard focus.
   */
  useEffect(() => {
    if (pickedId === null) {
      setTargetZoneId(null)
      previouslyPicked.current = null
      return
    }
    if (previouslyPicked.current === null) {
      const first = zonesRef.current[0] ?? null
      setTargetZoneId(first)
      if (first !== null) focusZone(first)
    }
    previouslyPicked.current = pickedId
  }, [focusZone, pickedId])

  const place = useCallback(
    (zoneId: string) => {
      setPickedId((current) => {
        if (current !== null) onPlace(current, zoneId)
        return null
      })
      // The "place here" button unmounts with the placement, so focus would fall to `<body>`;
      // parking it on the layer keeps the next Tab where the user left off. `targetZoneId` is
      // cleared by the effect above, which owns it.
      rootRef.current?.focus()
    },
    [onPlace],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingId(null)
      const zoneId = event.over?.id
      if (zoneId !== undefined) onPlace(String(event.active.id), String(zoneId))
    },
    [onPlace],
  )

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (pickedId === null) return
    if (event.key === 'Escape') {
      setPickedId(null)
      return
    }
    const zones = zonesRef.current
    if (zones.length === 0) return
    if (NEXT_KEYS.has(event.key) || PREVIOUS_KEYS.has(event.key)) {
      event.preventDefault()
      const index = targetZoneId === null ? -1 : zones.indexOf(targetZoneId)
      const step = NEXT_KEYS.has(event.key) ? 1 : -1
      const next = zones[(index + step + zones.length) % zones.length] as string
      setTargetZoneId(next)
      focusZone(next)
    }
  }

  const value = useMemo<PlacementContextValue>(
    () => ({ pickedId, pick, place, targetZoneId, registerZone, disabled: locked }),
    [locked, pick, pickedId, place, registerZone, targetZoneId],
  )

  return (
    <PlacementContext.Provider value={value}>
      <DndContext
        sensors={sensors}
        onDragStart={(event) => setDraggingId(String(event.active.id))}
        onDragCancel={() => setDraggingId(null)}
        onDragEnd={handleDragEnd}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the handler is a keyboard shortcut
            layer over children that are all focusable controls of their own, not a control itself. */}
        <div
          ref={rootRef}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          data-testid="drag-layer"
          className="outline-none"
        >
          {children}
        </div>
        <DragOverlay>
          {draggingId !== null && renderDragged ? renderDragged(draggingId) : null}
        </DragOverlay>
      </DndContext>
    </PlacementContext.Provider>
  )
}

export interface DraggableItemProps {
  id: string
  children: ReactNode
  className?: string
  /** Announced instead of the picked-up state, e.g. "Move «Paris» to a category". */
  ariaLabel?: string
}

/** One draggable: a `<button>` first, a dnd-kit pointer draggable second. */
export function DraggableItem({ id, children, className, ariaLabel }: DraggableItemProps) {
  const { pickedId, pick, disabled } = usePlacement()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled })
  const picked = pickedId === id

  return (
    <button
      // With only the `PointerSensor` installed, `listeners` is the pointer-down activator alone —
      // it never touches Enter or Space, which stay the select-then-place keys.
      {...attributes}
      {...listeners}
      type="button"
      ref={setNodeRef}
      disabled={disabled}
      aria-pressed={picked}
      aria-label={ariaLabel}
      data-testid={`draggable-${id}`}
      onClick={() => pick(id)}
      className={cn(
        'border-border bg-surface rounded-md border px-3 py-1.5 text-sm',
        'focus-visible:ring-brand-500 focus-visible:outline-none focus-visible:ring-2',
        picked && 'border-brand-500 ring-brand-500 ring-2',
        isDragging && 'opacity-40',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      {children}
    </button>
  )
}

export interface DropZoneProps {
  id: string
  children: ReactNode
  /** The accessible name of the "place here" action — a category label, a gap number… */
  label: string
  className?: string
}

/**
 * One drop target: a plain region for the pointer path, plus a real "place here" `<button>` that
 * appears while an item is picked up — the select-then-place half.
 *
 * The button is deliberately a *sibling* of the placed items rather than a wrapper around them:
 * a zone that already holds draggable buttons cannot itself be a button (nested interactive
 * elements are invalid HTML and a `nested-interactive` axe violation), and a `role="button"` div
 * would only move the same problem behind ARIA.
 */
export function DropZone({ id, children, label, className }: DropZoneProps) {
  const { pickedId, place, disabled, targetZoneId, registerZone } = usePlacement()
  const { setNodeRef, isOver } = useDroppable({ id, disabled })
  const armed = pickedId !== null && !disabled
  const { labels } = useActivity()

  useEffect(() => registerZone(id), [id, registerZone])

  return (
    <div
      ref={setNodeRef}
      data-testid={`dropzone-${id}`}
      className={cn(
        'border-border w-full rounded-md border border-dashed p-2 text-left',
        (isOver || (armed && targetZoneId === id)) &&
          'border-brand-500 bg-brand-50 dark:bg-brand-950/40',
        className,
      )}
    >
      {children}
      {armed && (
        <button
          type="button"
          onClick={() => place(id)}
          data-place-zone={id}
          data-testid={`place-${id}`}
          className={cn(
            'text-brand-700 dark:text-brand-300 mt-1 w-full rounded-md px-2 py-1 text-xs',
            'focus-visible:ring-brand-500 focus-visible:outline-none focus-visible:ring-2',
          )}
        >
          {`${labels.drop}: ${label}`}
        </button>
      )}
    </div>
  )
}
