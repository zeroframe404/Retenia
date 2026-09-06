import { buildTimeline, toGlobal, toLocal, totalDuration } from '@retenia/core'
import { type RefObject, useCallback, useEffect, useMemo, useState } from 'react'
import type { MediaPartRef } from './types'

/**
 * The one piece of state the player really has: where we are on the source's global timeline.
 *
 * A `<video>` element only knows about the file currently loaded into it, so for a course
 * every seek is really two operations — pick the part, then seek inside it — and every
 * reported position has to be translated back the other way before anything else in the app
 * sees it. Keeping that translation in a hook, over `@retenia/core`'s pure timeline functions,
 * means the transcript, the markers and the clip selection can all speak in global seconds and
 * never think about parts at all.
 *
 * A single recording is a one-part course, so there is no second code path for it.
 */

export interface MediaClock {
  /** Seconds on the source's global timeline. */
  globalSec: number
  /** Which part is loaded. */
  partIndex: number
  part: MediaPartRef | undefined
  totalSec: number | null
  playing: boolean
  /** Moves the playhead anywhere on the global timeline, switching parts if it has to. */
  seek: (globalSec: number) => void
  toggle: () => void
  /** Relative seek, for the J and L keys. */
  nudge: (deltaSec: number) => void
  /** Wire onto the media element. */
  onTimeUpdate: () => void
  onEnded: () => void
  onPlay: () => void
  onPause: () => void
}

export function useMediaClock(
  parts: readonly MediaPartRef[],
  element: RefObject<HTMLMediaElement | null>,
): MediaClock {
  const [partIndex, setPartIndex] = useState(0)
  const [globalSec, setGlobalSec] = useState(0)
  const [playing, setPlaying] = useState(false)
  /** Set when a seek lands in another part: applied once that part's media is ready, because
   *  `currentTime` is ignored on an element that has not loaded its new source yet. */
  const [pendingLocalSec, setPendingLocalSec] = useState<number | null>(null)

  const timeline = useMemo(() => buildTimeline(parts.map((part) => part.durationSec)), [parts])
  const totalSec = useMemo(() => totalDuration(timeline), [timeline])

  const seek = useCallback(
    (target: number) => {
      if (timeline.length === 0) return
      const position = toLocal(timeline, target)
      setGlobalSec(target)
      if (position.part === partIndex) {
        const media = element.current
        if (media !== null) media.currentTime = position.localSec
        return
      }
      // A different file has to load first; `onLoadedMetadata` applies the offset.
      setPartIndex(position.part)
      setPendingLocalSec(position.localSec)
    },
    [element, partIndex, timeline],
  )

  // Applies a cross-part seek once the new source is playable.
  useEffect(() => {
    if (pendingLocalSec === null) return
    const media = element.current
    if (media === null) return
    const apply = (): void => {
      media.currentTime = pendingLocalSec
      setPendingLocalSec(null)
      if (playing) void media.play().catch(() => undefined)
    }
    if (media.readyState >= 1) {
      apply()
      return
    }
    media.addEventListener('loadedmetadata', apply, { once: true })
    return () => media.removeEventListener('loadedmetadata', apply)
  }, [element, pendingLocalSec, playing])

  const onTimeUpdate = useCallback(() => {
    const media = element.current
    if (media === null || pendingLocalSec !== null) return
    setGlobalSec(toGlobal(timeline, partIndex, media.currentTime))
  }, [element, partIndex, pendingLocalSec, timeline])

  /**
   * Running off the end of one lecture continues into the next.
   *
   * Without this a course would stop twelve times, which is the single most obvious way a
   * multi-file source stops feeling like one recording.
   */
  const onEnded = useCallback(() => {
    const next = partIndex + 1
    if (next >= parts.length) {
      setPlaying(false)
      return
    }
    setPartIndex(next)
    setPendingLocalSec(0)
    setGlobalSec(timeline[next]?.startSec ?? 0)
  }, [partIndex, parts.length, timeline])

  const toggle = useCallback(() => {
    const media = element.current
    if (media === null) return
    if (media.paused) void media.play().catch(() => undefined)
    else media.pause()
  }, [element])

  const nudge = useCallback(
    (deltaSec: number) => {
      const ceiling = totalSec ?? Number.POSITIVE_INFINITY
      seek(Math.min(ceiling, Math.max(0, globalSec + deltaSec)))
    },
    [globalSec, seek, totalSec],
  )

  return {
    globalSec,
    partIndex,
    part: parts[partIndex],
    totalSec,
    playing,
    seek,
    toggle,
    nudge,
    onTimeUpdate,
    onEnded,
    onPlay: useCallback(() => setPlaying(true), []),
    onPause: useCallback(() => setPlaying(false), []),
  }
}

/** `12:30`, or `1:02:30` past the hour — the same shape citations use. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(whole / 3_600)
  const minutes = Math.floor((whole % 3_600) / 60)
  const secs = whole % 60
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(secs).padStart(2, '0')}`
}
