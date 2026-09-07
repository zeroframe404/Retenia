import { Button } from '@retenia/ui'
import { ClipboardIcon, HighlighterIcon, PlusCircleIcon, SparklesIcon } from 'lucide-react'
import type { SelectionToolbarLabels } from './types'

export interface SelectionToolbarProps {
  labels: SelectionToolbarLabels
  /** Viewport coordinates (CSS pixels) — the toolbar centers itself horizontally on this
   *  point and sits just above it, which is where a text-selection toolbar is expected to
   *  appear (Notion, Google Docs). */
  position: { x: number; y: number }
  onHighlight: () => void
  onCreateCard: () => void
  /** Absent hides the button: the AI tutor this opens is sub-phase 9.4's, not built yet
   *  (mirrors `MediaPlayer`'s `onCreateClip?` — an optional affordance, not a disabled one). */
  onAskAi?: () => void
  onCopyWithCitation: () => void
}

/**
 * The floating toolbar over a text selection: "Resaltar", "Crear tarjeta", "Preguntar a la
 * IA" (port; the tutor itself is sub-phase 9.4), "Copiar con cita". Shared by `PdfReader` and
 * `EpubReader` so the highlight → item flow looks and behaves identically in both.
 */
export function SelectionToolbar({
  labels,
  position,
  onHighlight,
  onCreateCard,
  onAskAi,
  onCopyWithCitation,
}: SelectionToolbarProps) {
  return (
    // `fixed`, not `absolute`: `position` is already in viewport coordinates
    // (`getBoundingClientRect()` on the selection range), and a reader's own scrolling
    // container must not shift the toolbar out from under the selection it belongs to.
    <div
      role="toolbar"
      aria-label={labels.highlight}
      className="bg-surface border-border fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-md border p-1 shadow-lg"
      style={{ left: position.x, top: position.y }}
      // The selection would otherwise collapse the moment a toolbar button steals focus.
      onMouseDown={(event) => event.preventDefault()}
    >
      <Button variant="ghost" size="sm" onClick={onHighlight}>
        <HighlighterIcon className="size-3.5" />
        {labels.highlight}
      </Button>
      <Button variant="ghost" size="sm" onClick={onCreateCard}>
        <PlusCircleIcon className="size-3.5" />
        {labels.createCard}
      </Button>
      {onAskAi !== undefined && (
        <Button variant="ghost" size="sm" onClick={onAskAi}>
          <SparklesIcon className="size-3.5" />
          {labels.askAi}
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onCopyWithCitation}>
        <ClipboardIcon className="size-3.5" />
        {labels.copyWithCitation}
      </Button>
    </div>
  )
}
