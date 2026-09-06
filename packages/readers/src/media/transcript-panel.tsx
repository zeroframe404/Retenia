import { ScrollArea } from '@retenia/ui'
import { useEffect, useRef } from 'react'
import type { MediaPlayerLabels, TranscriptCue } from './types'

/**
 * The transcript, as a list of buttons that seek.
 *
 * A `<button>` per cue rather than a styled `<div>` with a click handler: this is the primary
 * way of navigating a two-hour lecture, and it has to be reachable by keyboard and announced
 * as actionable. `aria-current` marks the line being spoken, which is what a screen reader
 * needs to answer "where are we".
 *
 * Following the playhead is a toggle, and it turns itself off when the reader scrolls. Anyone
 * who has tried to read back over a paragraph while a video keeps playing knows why: a panel
 * that yanks itself back to the playhead every second is unusable for exactly the task the
 * transcript exists for.
 */

export interface TranscriptPanelProps {
  cues: readonly TranscriptCue[]
  labels: MediaPlayerLabels
  activeCueId: string | null
  followPlayhead: boolean
  onFollowPlayheadChange: (value: boolean) => void
  onSeek: (globalSec: number) => void
}

export function TranscriptPanel({
  cues,
  labels,
  activeCueId,
  followPlayhead,
  onFollowPlayheadChange,
  onSeek,
}: TranscriptPanelProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!followPlayhead || activeCueId === null) return
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeCueId, followPlayhead])

  if (cues.length === 0) {
    return <p className="text-muted text-sm">{labels.noTranscript}</p>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-text text-sm font-medium">{labels.transcript}</h3>
        <label className="text-muted flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={followPlayhead}
            onChange={(event) => onFollowPlayheadChange(event.target.checked)}
          />
          {labels.followPlayhead}
        </label>
      </div>

      <ScrollArea
        className="max-h-64 min-h-0 flex-1"
        // A user scroll means they are reading, not watching.
        onWheel={() => onFollowPlayheadChange(false)}
      >
        <ul className="flex flex-col">
          {cues.map((cue) => {
            const active = cue.id === activeCueId
            return (
              <li key={cue.id}>
                <button
                  type="button"
                  ref={active ? activeRef : null}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onSeek(cue.startSec)}
                  className={`hover:bg-surface flex w-full gap-2 rounded px-2 py-1 text-left text-sm ${
                    active ? 'bg-surface text-text' : 'text-muted'
                  }`}
                >
                  <span className="text-muted shrink-0 tabular-nums">{cue.label}</span>
                  <span>{cue.text}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </ScrollArea>
    </div>
  )
}
