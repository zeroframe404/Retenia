import { ScrollArea } from '@retenia/ui'
import type { KeyframeMarker, MediaPlayerLabels } from './types'

/**
 * The slides, as a filmstrip that seeks.
 *
 * The keyframes are already markers on the scrubber; this is the other half of the same idea,
 * and the more useful one for a screencast: "which slide was that" is a question people answer
 * by looking, not by scrubbing. Each thumbnail's alt text is the frame's OCR when there was
 * any, so the strip is navigable without seeing it — which is also what makes the OCR pass
 * worth its cost beyond feeding the lesson prompts.
 */

export interface KeyframeStripProps {
  keyframes: readonly KeyframeMarker[]
  labels: MediaPlayerLabels
  /** Global seconds, for highlighting the frame currently on screen. */
  activeSec: number
  onSeek: (globalSec: number) => void
}

export function KeyframeStrip({ keyframes, labels, activeSec, onSeek }: KeyframeStripProps) {
  if (keyframes.length === 0) {
    return <p className="text-muted text-sm">{labels.noKeyframes}</p>
  }

  // The frame on screen is the last one whose time has passed.
  const activeId = [...keyframes].filter((frame) => frame.timeSec <= activeSec).at(-1)?.id

  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-text text-sm font-medium">{labels.keyframes}</h3>
      <ScrollArea className="w-full">
        <ul className="flex gap-2 pb-2">
          {keyframes.map((frame) => (
            <li key={frame.id}>
              <button
                type="button"
                onClick={() => onSeek(frame.timeSec)}
                aria-current={frame.id === activeId ? 'true' : undefined}
                className={`border-border block shrink-0 overflow-hidden rounded border ${
                  frame.id === activeId ? 'border-brand-500' : ''
                }`}
              >
                <img
                  src={frame.src}
                  alt={frame.text ?? ''}
                  className="h-16 w-auto"
                  loading="lazy"
                />
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  )
}
