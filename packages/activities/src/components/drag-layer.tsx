import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
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
import { formatLabel } from '../labels'

/**
 * The drag-and-drop layer every placement family shares (`cloze` word banks, `pairs`,
 * `categorize`, `ordering`), and — the part §9 actually mandates — **its keyboard alternative**:
 * *"a keyboard alternative for every drag-and-drop (as Rise/H5P require)"*.
 *
 * Two input paths, one model:
 *
 * - **Pointer.** dnd-kit's `PointerSensor`: pick up and drop with the mouse or a finger. The token
 *   follows the pointer, because `DraggableItem` applies dnd-kit's `transform` to itself.
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
 *
 * **Every moment the answer changes is announced, and none of them drops focus.** Reaching a zone
 * is announced by focus, but picking up, placing, cancelling and removing all rearrange the tree
 * under the control that caused them — the "place here" button and the "Remove" button both
 * unmount — so without help focus falls to `<body>` and nothing is read out. The layer therefore
 * owns one polite live region and one post-render focus request, and both input paths and the
 * families' own removal controls report through them: *"«París» picked up"*, *"«París» placed in
 * Gap 1"*, *"«París» removed from Gap 1"*, *"«París» put back"*. Draggables and zones hand over
 * the names those sentences use when they register; a family that owns a control of its own
 * (`usePlacement().reportRemoval`) hands over the name itself, because a token that has left the
 * bank is no longer registered here.
 */

export interface PlacementContextValue {
  /** The item currently picked up, by either path. */
  pickedId: string | null
  pick: (itemId: string | null) => void
  place: (zoneId: string) => void
  /** The zone the arrow keys are currently on, while an item is held. */
  targetZoneId: string | null
  /** A zone joins the arrow-key ring under `zoneId`, and lends `label` to the announcements. */
  registerZone: (zoneId: string, label: string) => () => void
  /** A draggable lends the name the announcements call it by; ids are not for reading out. */
  registerItem: (itemId: string, name: string) => () => void
  /**
   * A family's own "Remove"/"Clear" control took a token back out — the third moment the answer
   * changes, and the one this layer does not own. Announces it and sends focus back to the token,
   * which is in the bank again; without it focus falls to `<body>`, because the control that was
   * pressed unmounts with the placement it undid.
   *
   * `itemName` is passed rather than looked up: a token that was placed has usually left the bank,
   * so it is no longer a registered draggable and the layer knows only its id. `itemId` is
   * optional for the same reason in reverse — `cloze` keys its gaps by text, and a gap filled by
   * typing has no token at all — and focus then goes to the first token in the bank instead.
   */
  reportRemoval: (removal: { itemId?: string; itemName: string; zoneId: string }) => void
  /** One sentence into the layer's live region, for a change only the family can describe. */
  announce: (text: string) => void
  /**
   * After the next render, focus the first of these CSS selectors that matches an enabled element
   * inside the layer; the layer root if none does. For a control that unmounts, or is disabled, as
   * a result of what it just did — a "place here" button, a Move-up at the top of the list.
   */
  focusAfterUpdate: (selectors: readonly string[]) => void
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
  /**
   * The zones, the bank and everything between them.
   *
   * A function child is handed the same value `usePlacement()` returns. It exists for the one
   * thing the hook cannot reach: a family's own Remove and Move controls are declared in the
   * component that *renders* this layer — above its provider — so they have no context to read.
   */
  children: ReactNode | ((placement: PlacementContextValue) => ReactNode)
}

const NEXT_KEYS = new Set(['ArrowDown', 'ArrowRight'])
const PREVIOUS_KEYS = new Set(['ArrowUp', 'ArrowLeft'])

/** One draggable, by id. */
const draggableSelector = (itemId: string) => `[data-testid="draggable-${itemId}"]`
/** Any draggable, in DOM order — the fallback when the one just used is gone from the bank. */
const ANY_DRAGGABLE = '[data-testid^="draggable-"]'

interface RegisteredZone {
  id: string
  label: string
}

/**
 * dnd-kit's own announcements are silenced in favour of the live region below. Theirs read raw ids
 * — *"Draggable item w2 was dropped"* — which is the opposite of the point, and they only ever fire
 * on the pointer path, so leaving them on would give the two paths two different voices.
 */
const SILENT_ANNOUNCEMENTS: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
}

/** One thing said out loud. The nonce is what makes the *same* sentence twice a DOM change, which
 *  is the only thing an `aria-live` region reacts to. */
interface Announcement {
  nonce: number
  text: string
}

/** One pending focus move, resolved after the render that removed whatever held focus. */
interface FocusRequest {
  nonce: number
  selectors: readonly string[]
}

export function DragLayer({ onPlace, children }: DragLayerProps) {
  const { locked, labels } = useActivity()
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [targetZoneId, setTargetZoneId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const zonesRef = useRef<RegisteredZone[]>([])
  const namesRef = useRef(new Map<string, string>())
  const rootRef = useRef<HTMLDivElement>(null)
  const previouslyPicked = useRef<string | null>(null)
  /** `pickedId`'s synchronous mirror, so a handler can read it without an impure state updater. */
  const pickedRef = useRef<string | null>(null)
  const nonceRef = useRef(0)
  // `distance: 5` is what makes a *click* on a draggable still a click. With no activation
  // constraint the `PointerSensor` starts a drag on `pointerdown` and, from that moment, swallows
  // the following `click` with a capturing `stopPropagation` — so tapping a token to pick it up
  // (the pointer half of select-then-place, and the only pointer path a touch user has short of a
  // real drag) never reached the button's `onClick` at all. Below the threshold nothing is
  // dragged, the click lands; above it, the drag starts as before.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Zones register in mount order, which is DOM order for every family here, so the arrow keys
  // walk them the way they read.
  const registerZone = useCallback((zoneId: string, label: string) => {
    zonesRef.current = [...zonesRef.current, { id: zoneId, label }]
    return () => {
      zonesRef.current = zonesRef.current.filter((zone) => zone.id !== zoneId)
    }
  }, [])

  const registerItem = useCallback((itemId: string, name: string) => {
    namesRef.current.set(itemId, name)
    return () => {
      namesRef.current.delete(itemId)
    }
  }, [])

  const announce = useCallback((text: string) => {
    nonceRef.current += 1
    setAnnouncement({ nonce: nonceRef.current, text })
  }, [])

  const focusAfterUpdate = useCallback((selectors: readonly string[]) => {
    nonceRef.current += 1
    setFocusRequest({ nonce: nonceRef.current, selectors })
  }, [])

  /**
   * Resolves the pending focus request, one render after it was made — which is the point: the
   * element that held focus is gone by now, and the one to move to may only exist now.
   */
  useEffect(() => {
    if (focusRequest === null) return
    const root = rootRef.current
    if (root === null) return
    for (const selector of focusRequest.selectors) {
      for (const candidate of root.querySelectorAll<HTMLElement>(selector)) {
        if (!candidate.hasAttribute('disabled')) {
          candidate.focus()
          return
        }
      }
    }
    // Nothing to go to — a bank emptied by the last placement. The layer itself is focusable so
    // that focus at least stays inside the widget.
    root.focus()
  }, [focusRequest])

  /** The name a live region should use; the id is the last resort, never the first. */
  const nameOf = useCallback((itemId: string) => namesRef.current.get(itemId) ?? itemId, [])
  const zoneNameOf = useCallback(
    (zoneId: string) => zonesRef.current.find((zone) => zone.id === zoneId)?.label ?? zoneId,
    [],
  )

  const announcePickUp = useCallback(
    (itemId: string) =>
      announce(formatLabel(labels.pickedUpAnnouncement, { item: nameOf(itemId) })),
    [announce, labels.pickedUpAnnouncement, nameOf],
  )
  const announcePlacement = useCallback(
    (itemId: string, zoneId: string) =>
      announce(
        formatLabel(labels.placedAnnouncement, {
          item: nameOf(itemId),
          zone: zoneNameOf(zoneId),
        }),
      ),
    [announce, labels.placedAnnouncement, nameOf, zoneNameOf],
  )

  const pick = useCallback(
    (itemId: string | null) => {
      const next = pickedRef.current === itemId ? null : itemId
      pickedRef.current = next
      setPickedId(next)
      if (next !== null) announcePickUp(next)
    },
    [announcePickUp],
  )

  /** Moves focus onto a zone's "place here" button, so its name is announced as it is reached. */
  const focusZone = useCallback((zoneId: string) => {
    rootRef.current?.querySelector<HTMLElement>(`[data-place-zone="${zoneId}"]`)?.focus()
  }, [])

  /**
   * Picking something up parks the cursor on the first zone and moves focus there, so the zone's
   * name is announced and Enter drops straight away.
   *
   * This is an effect rather than part of `pick` for one reason: the "place here" button only
   * exists from the render that follows the pick-up.
   */
  useEffect(() => {
    if (pickedId === null) {
      setTargetZoneId(null)
      previouslyPicked.current = null
      return
    }
    if (previouslyPicked.current === null) {
      const first = zonesRef.current[0]?.id ?? null
      setTargetZoneId(first)
      if (first !== null) focusZone(first)
    }
    previouslyPicked.current = pickedId
  }, [focusZone, pickedId])

  const place = useCallback(
    (zoneId: string) => {
      const itemId = pickedRef.current
      if (itemId !== null) {
        onPlace(itemId, zoneId)
        announcePlacement(itemId, zoneId)
      }
      pickedRef.current = null
      setPickedId(null)
      // The "place here" button unmounts with the placement, so focus has to be told where to go.
      // Forward, into the bank: the same token when it is still there (a bank that is not
      // `singleUse` keeps a placed token, greyed out, and that is where the user was working), and
      // otherwise the next token still to place. Parking it on the layer root instead sends the
      // next Tab to the *first* control of the whole widget — in `ordering` the answer area's
      // Move/Remove buttons — so the walk back to the bank got longer with every token placed.
      focusAfterUpdate(itemId === null ? [] : [draggableSelector(itemId), ANY_DRAGGABLE])
      // `targetZoneId` is cleared by the effect above, which owns it.
    },
    [announcePlacement, focusAfterUpdate, onPlace],
  )

  const announceCancellation = useCallback(
    (itemId: string) =>
      announce(formatLabel(labels.cancelledAnnouncement, { item: nameOf(itemId) })),
    [announce, labels.cancelledAnnouncement, nameOf],
  )

  /**
   * Putting down what was picked up, with the answer unchanged — Escape, or a pointer drag that
   * ends over nothing. It is announced for the same reason a placement is: the region is
   * `aria-atomic`, so leaving *"«París» picked up"* standing describes a state that is over.
   */
  const cancelPickUp = useCallback(() => {
    const itemId = pickedRef.current
    pickedRef.current = null
    setPickedId(null)
    if (itemId === null) return
    announceCancellation(itemId)
    // Back to the token it came from: focus is on that zone's "place here" button, which the next
    // render removes.
    focusAfterUpdate([draggableSelector(itemId)])
  }, [announceCancellation, focusAfterUpdate])

  const reportRemoval = useCallback(
    ({ itemId, itemName, zoneId }: { itemId?: string; itemName: string; zoneId: string }) => {
      announce(
        formatLabel(labels.removedAnnouncement, { item: itemName, zone: zoneNameOf(zoneId) }),
      )
      focusAfterUpdate(
        itemId === undefined ? [ANY_DRAGGABLE] : [draggableSelector(itemId), ANY_DRAGGABLE],
      )
    },
    [announce, focusAfterUpdate, labels.removedAnnouncement, zoneNameOf],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const itemId = String(event.active.id)
      const zoneId = event.over?.id
      // Released over nothing: the answer is unchanged, and saying so is what stops the region
      // from still reading "picked up" while the token sits back in the bank.
      if (zoneId === undefined) {
        announceCancellation(itemId)
        return
      }
      onPlace(itemId, String(zoneId))
      announcePlacement(itemId, String(zoneId))
    },
    [announceCancellation, announcePlacement, onPlace],
  )

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (pickedId === null) return
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelPickUp()
      return
    }
    const zones = zonesRef.current
    if (zones.length === 0) return
    if (NEXT_KEYS.has(event.key) || PREVIOUS_KEYS.has(event.key)) {
      event.preventDefault()
      const index = targetZoneId === null ? -1 : zones.findIndex((zone) => zone.id === targetZoneId)
      const step = NEXT_KEYS.has(event.key) ? 1 : -1
      const next = zones[(index + step + zones.length) % zones.length]?.id
      if (next === undefined) return
      setTargetZoneId(next)
      focusZone(next)
    }
  }

  const value = useMemo<PlacementContextValue>(
    () => ({
      pickedId,
      pick,
      place,
      targetZoneId,
      registerZone,
      registerItem,
      reportRemoval,
      announce,
      focusAfterUpdate,
      disabled: locked,
    }),
    [
      announce,
      focusAfterUpdate,
      locked,
      pick,
      pickedId,
      place,
      registerItem,
      registerZone,
      reportRemoval,
      targetZoneId,
    ],
  )

  return (
    <PlacementContext.Provider value={value}>
      <DndContext
        sensors={sensors}
        // The default instructions describe the `KeyboardSensor` this layer deliberately does not
        // install ("to pick up a draggable item, press the space bar"), so a screen-reader user was
        // being told to press a key that does nothing. `dragKeyboardHint` is the sentence the token
        // bank already shows, and it describes the keys that are actually wired up.
        accessibility={{
          screenReaderInstructions: { draggable: labels.dragKeyboardHint },
          announcements: SILENT_ANNOUNCEMENTS,
        }}
        onDragStart={(event) => announcePickUp(String(event.active.id))}
        onDragCancel={(event) => announceCancellation(String(event.active.id))}
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
          {typeof children === 'function' ? children(value) : children}
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid="placement-announcer"
            className="sr-only"
          >
            {announcement && <span key={announcement.nonce}>{announcement.text}</span>}
          </div>
        </div>
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

/** The name the live region calls this draggable by: its own label, or the text it renders. */
function nameOfChildren(children: ReactNode): string | undefined {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  return undefined
}

/** One draggable: a `<button>` first, a dnd-kit pointer draggable second. */
export function DraggableItem({ id, children, className, ariaLabel }: DraggableItemProps) {
  const { pickedId, pick, disabled, registerItem } = usePlacement()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    disabled,
  })
  const picked = pickedId === id
  const name = ariaLabel ?? nameOfChildren(children) ?? id

  useEffect(() => registerItem(id, name), [id, name, registerItem])

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
      // dnd-kit tracks the pointer but moves nothing by itself: without this the token stayed
      // where it was for the whole drag and only jumped on release, which is no feedback at all.
      // Translating the token itself rather than drawing a `DragOverlay` copy keeps one element
      // per token — the same one the keyboard path presses.
      style={transform ? { transform: CSS.Translate.toString(transform) } : undefined}
      className={cn(
        'border-border bg-surface rounded-md border px-3 py-1.5 text-sm',
        'focus-visible:ring-brand-500 focus-visible:outline-none focus-visible:ring-2',
        picked && 'border-brand-500 ring-brand-500 ring-2',
        isDragging && 'relative z-10 shadow-lg',
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
  /**
   * The accessible name of the "place here" action — a category label, a gap number…
   *
   * Plain text: it is rendered inside a button and read out in the announcements, so a family
   * whose payload field is `RichText` passes it through `toPlainText` rather than raw.
   */
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

  useEffect(() => registerZone(id, label), [id, label, registerZone])

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
