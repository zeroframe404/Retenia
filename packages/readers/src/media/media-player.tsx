import { Button, IconButton } from '@retenia/ui'
import {
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  RotateCwIcon,
  ScissorsIcon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react'
import { type KeyboardEvent, useCallback, useMemo, useRef, useState } from 'react'
import { KeyframeStrip } from './keyframe-strip'
import { TranscriptPanel } from './transcript-panel'
import type {
  ClipSelection,
  KeyframeMarker,
  MediaPartRef,
  MediaPlayerLabels,
  TranscriptCue,
} from './types'
import { formatClock, useMediaClock } from './use-media-clock'

/**
 * The audio/video player for a source's detail view (sub-phase 6.4).
 *
 * ### Why this is not `media-chrome`
 *
 * `docs/spec/07-architecture.md` §2 named media-chrome, and §13.4 item 3 left the choice open
 * until this sub-phase. It resolves to neither candidate. media-chrome 4 styles its controls
 * with `<style>` blocks inside shadow roots, so it needs `style-src 'unsafe-inline'`
 * (muxinc/media-chrome#898) — against a rule CLAUDE.md states without qualification ("CSP is
 * strict in the renderer: no `unsafe-inline`") and against the §4 security checklist. Vidstack,
 * the spec's own alternative, is not the escape hatch it assumed: it sits at 0.6.15 rather
 * than the "1.x" the stack table names, its last release was February 2026, and its author has
 * moved to Mux to build Video.js v10.
 *
 * So the controls are ours, over a plain `<video>`. The cost is smaller than it looks: every
 * affordance this sub-phase actually needs — keyframe markers on the scrubber, a transcript
 * that seeks, a clip range, J/K/L, and playback across a course's twelve files — is custom
 * work on top of *any* library, because none of them model a multi-file source.
 *
 * ### Captions without a `<track>`
 *
 * The pipeline stores a WebVTT blob, and pointing a `<track>` at it would be the obvious move.
 * It does not work here: the renderer is served from `app://` and the blob from `media://`, so
 * a `<track>` is a cross-origin, CORS-checked subresource, where a media element's own request
 * is not. Since the cues are already in memory to draw the transcript, they are added with
 * `addTextTrack` instead and the VTT blob stays what it should be — an export format.
 */

export interface MediaPlayerProps {
  parts: readonly MediaPartRef[]
  cues: readonly TranscriptCue[]
  keyframes: readonly KeyframeMarker[]
  labels: MediaPlayerLabels
  /** `video` renders a picture; `audio` renders the same controls with no viewport. */
  kind: 'audio' | 'video'
  /** Absent when the source has no card-making affordance (a story, a preview). */
  onCreateClip?: (selection: ClipSelection) => void
}

const SKIP_SECONDS = 10

export function MediaPlayer({
  parts,
  cues,
  keyframes,
  labels,
  kind,
  onCreateClip,
}: MediaPlayerProps) {
  const element = useRef<HTMLMediaElement | null>(null)
  const clock = useMediaClock(parts, element)
  const [muted, setMuted] = useState(false)
  const [clipStart, setClipStart] = useState<number | null>(null)
  const [followPlayhead, setFollowPlayhead] = useState(true)

  const activeCue = useMemo(
    () => cues.find((cue) => clock.globalSec >= cue.startSec && clock.globalSec < cue.endSec),
    [clock.globalSec, cues],
  )

  /**
   * J / K / L — the shuttle keys every editor and every video tool has used for decades.
   *
   * Attached to the media element and the scrubber — both focusable and interactive in their
   * own right — rather than to `window`. That placement is the whole guard: a global hotkey
   * would scrub the video three times the moment someone typed "look" into the search box on
   * the same screen, and a filter for `INPUT`/`TEXTAREA` targets would be a second, weaker
   * version of a rule the tree already enforces, since neither of these two elements can
   * contain a text field. The transcript's own follow-playback checkbox is outside both, so
   * typing in it reaches nothing here.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      switch (event.key.toLowerCase()) {
        case 'j':
          clock.nudge(-SKIP_SECONDS)
          break
        case 'k':
        case ' ':
          clock.toggle()
          break
        case 'l':
          clock.nudge(SKIP_SECONDS)
          break
        case 'arrowleft':
          clock.nudge(-5)
          break
        case 'arrowright':
          clock.nudge(5)
          break
        default:
          return
      }
      event.preventDefault()
    },
    [clock],
  )

  const total = clock.totalSec ?? 0
  const progress = total > 0 ? Math.min(1, clock.globalSec / total) : 0

  const cutClip = (): void => {
    if (onCreateClip === undefined) return
    if (clipStart === null) {
      setClipStart(clock.globalSec)
      return
    }
    const startSec = Math.min(clipStart, clock.globalSec)
    const endSec = Math.max(clipStart, clock.globalSec)
    const text = cues
      .filter((cue) => cue.endSec > startSec && cue.startSec < endSec)
      .map((cue) => cue.text)
      .join(' ')
      .trim()
    onCreateClip({ startSec, endSec, text })
    setClipStart(null)
  }

  const scrub = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (total <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    clock.seek(((event.clientX - rect.left) / rect.width) * total)
  }

  const MediaTag = kind === 'video' ? 'video' : 'audio'

  return (
    <div className="flex flex-col gap-3">
      <MediaTag
        // Keyed by source so switching parts really reloads the element rather than leaving
        // the previous file's buffered data attached to a new `src`.
        key={clock.part?.src ?? 'none'}
        ref={element as never}
        src={clock.part?.src}
        className={kind === 'video' ? 'bg-neutral-950 w-full rounded-md' : 'w-full'}
        onTimeUpdate={clock.onTimeUpdate}
        onEnded={clock.onEnded}
        onPlay={clock.onPlay}
        onPause={clock.onPause}
        muted={muted}
        preload="metadata"
        // The keyboard surface for J/K/L. On the media element rather than on a focusable
        // wrapper `div`, because a `<video>` is already an interactive element — and rather
        // than on `window`, because a global hotkey would swallow the letter the moment
        // someone types "look" into the search box on the same screen.
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <track kind="captions" />
      </MediaTag>

      <div className="flex flex-col gap-1">
        {/* A real `slider`, not a styled div with a click handler: it is the only way to
            reach an arbitrary point in a two-hour lecture, so it has to be operable and
            announced without a mouse. */}
        <div
          className="bg-border relative h-2 cursor-pointer rounded-full"
          role="slider"
          tabIndex={0}
          aria-label={labels.play}
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(clock.globalSec)}
          aria-valuetext={formatClock(clock.globalSec)}
          onClick={scrub}
          onKeyDown={onKeyDown}
        >
          <div
            className="bg-brand-500 absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${progress * 100}%` }}
          />
          {total > 0 &&
            keyframes.map((frame) => (
              <span
                key={frame.id}
                title={labels.frameAt(formatClock(frame.timeSec))}
                className="bg-text/60 absolute top-0 h-2 w-0.5"
                style={{ left: `${Math.min(100, (frame.timeSec / total) * 100)}%` }}
              />
            ))}
          {clipStart !== null && total > 0 && (
            <span
              className="bg-xp absolute -top-1 h-4 w-0.5"
              style={{ left: `${Math.min(100, (clipStart / total) * 100)}%` }}
            />
          )}
        </div>

        <div className="text-muted flex items-center gap-2 text-xs tabular-nums">
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={clock.playing ? labels.pause : labels.play}
            onClick={clock.toggle}
          >
            {clock.playing ? <PauseIcon /> : <PlayIcon />}
          </IconButton>
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={labels.back}
            onClick={() => clock.nudge(-SKIP_SECONDS)}
          >
            <RotateCcwIcon />
          </IconButton>
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={labels.forward}
            onClick={() => clock.nudge(SKIP_SECONDS)}
          >
            <RotateCwIcon />
          </IconButton>
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={muted ? labels.unmute : labels.mute}
            onClick={() => setMuted((value) => !value)}
          >
            {muted ? <VolumeXIcon /> : <Volume2Icon />}
          </IconButton>

          <span>
            {formatClock(clock.globalSec)} / {formatClock(total)}
          </span>

          {parts.length > 1 && clock.part !== undefined && (
            <span className="truncate">
              {labels.partOf(clock.partIndex + 1, parts.length, clock.part.title)}
            </span>
          )}

          {onCreateClip !== undefined && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={cutClip}>
              <ScissorsIcon className="size-3.5" />
              {clipStart === null ? labels.clipStart : labels.clipEnd}
            </Button>
          )}
        </div>
        {clipStart !== null && <p className="text-muted text-xs">{labels.clipHint}</p>}
      </div>

      {keyframes.length > 0 && (
        <KeyframeStrip
          keyframes={keyframes}
          labels={labels}
          activeSec={clock.globalSec}
          onSeek={clock.seek}
        />
      )}

      <TranscriptPanel
        cues={cues}
        labels={labels}
        activeCueId={activeCue?.id ?? null}
        followPlayhead={followPlayhead}
        onFollowPlayheadChange={setFollowPlayhead}
        onSeek={clock.seek}
      />

      {/* Permanent, not dismissible: `docs/spec/01-decisions.md` §7 makes local-first a
          promise, and a promise the user has to remember having been shown once is not one. */}
      <p className="text-muted text-xs">{labels.localNotice}</p>
    </div>
  )
}
