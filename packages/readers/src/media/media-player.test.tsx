import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { MediaPlayer } from './media-player'
import type { KeyframeMarker, MediaPartRef, MediaPlayerLabels, TranscriptCue } from './types'
import { formatClock } from './use-media-clock'

/**
 * The player's behaviour, at the level the rest of the app depends on: a click on a
 * transcript line moves the playhead, J/K/L reach the player and nothing else, and a course's
 * many files behave like one recording.
 *
 * jsdom implements no media pipeline — `play()` and `pause()` are unimplemented and
 * `currentTime` never advances on its own — so the tests drive the element the way a browser
 * would (set `currentTime`, dispatch `timeupdate`) and assert on what the component does with
 * it. That is the seam that matters anyway: everything else in the app talks to this
 * component through global seconds, never through the element.
 */

beforeAll(() => {
  // jsdom throws "Not implemented" for both, which would turn every play/pause assertion into
  // an unhandled error rather than a test of our own logic.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn(async function play(this: HTMLMediaElement) {
      this.dispatchEvent(new Event('play'))
    }),
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn(function pause(this: HTMLMediaElement) {
      this.dispatchEvent(new Event('pause'))
    }),
  })
  Element.prototype.scrollIntoView = vi.fn()
})

const labels: MediaPlayerLabels = {
  play: 'Play',
  pause: 'Pause',
  mute: 'Mute',
  unmute: 'Unmute',
  back: 'Back',
  forward: 'Forward',
  transcript: 'Transcript',
  keyframes: 'Slides',
  noTranscript: 'No transcript',
  noKeyframes: 'No slides',
  followPlayhead: 'Follow',
  clip: 'Clip',
  clipStart: 'Mark the start',
  clipEnd: 'Create a card',
  clipSave: 'Save',
  clipCancel: 'Cancel',
  clipHint: 'Move to the end',
  localNotice: 'Processed locally.',
  partOf: (index, total, title) => `Lesson ${index} of ${total}: ${title}`,
  frameAt: (label) => `Slide at ${label}`,
}

/** Three lessons, laid end to end — the shape a course folder produces. */
const parts: MediaPartRef[] = [
  {
    src: 'media://blob/aa.mp4',
    mime: 'video/mp4',
    title: 'Welcome',
    startSec: 0,
    durationSec: 100,
  },
  {
    src: 'media://blob/bb.mp4',
    mime: 'video/mp4',
    title: 'Setup',
    startSec: 100,
    durationSec: 200,
  },
  { src: 'media://blob/cc.mp4', mime: 'video/mp4', title: 'First', startSec: 300, durationSec: 60 },
]

const cues: TranscriptCue[] = [
  { id: 'c1', startSec: 0, endSec: 10, text: 'Welcome to the course.', label: '0:00' },
  { id: 'c2', startSec: 10, endSec: 40, text: 'Lets get started.', label: '0:10' },
  { id: 'c3', startSec: 150, endSec: 180, text: 'Download the installer.', label: '2:30' },
]

const keyframes: KeyframeMarker[] = [
  { id: 'k1', timeSec: 5, src: 'media://blob/11.png', text: 'Welcome' },
  { id: 'k2', timeSec: 160, src: 'media://blob/22.png', text: 'Install' },
]

function renderPlayer(overrides: Partial<Parameters<typeof MediaPlayer>[0]> = {}) {
  const result = render(
    <MediaPlayer
      kind="video"
      parts={parts}
      cues={cues}
      keyframes={keyframes}
      labels={labels}
      {...overrides}
    />,
  )
  const media = result.container.querySelector('video') as HTMLVideoElement
  return { ...result, media }
}

/** What a browser does when playback moves: set the time, then tell the page. */
function advanceTo(media: HTMLMediaElement, localSec: number): void {
  act(() => {
    media.currentTime = localSec
    fireEvent.timeUpdate(media)
  })
}

describe('MediaPlayer', () => {
  it('loads the first part and reports the source total, not the part total', () => {
    const { media } = renderPlayer()
    expect(media.getAttribute('src')).toBe('media://blob/aa.mp4')
    // 100 + 200 + 60 — a course reads as one recording, which is the whole point of the
    // virtual timeline.
    expect(screen.getByText(`0:00 / ${formatClock(360)}`)).toBeInTheDocument()
  })

  it('seeks within the current part when a transcript line is clicked', async () => {
    const user = userEvent.setup()
    const { media } = renderPlayer()
    await user.click(screen.getByRole('button', { name: /Lets get started/ }))
    expect(media.currentTime).toBe(10)
  })

  it('switches part when the transcript line lives in a later one', async () => {
    const user = userEvent.setup()
    const { container } = renderPlayer()
    await user.click(screen.getByRole('button', { name: /Download the installer/ }))

    // Part 2 starts at 100 s, so a cue at 150 s is 50 s into it.
    const media = container.querySelector('video') as HTMLVideoElement
    expect(media.getAttribute('src')).toBe('media://blob/bb.mp4')
    act(() => {
      fireEvent.loadedMetadata(media)
    })
    expect(media.currentTime).toBe(50)
  })

  it('marks the cue being spoken, so the transcript can be followed', () => {
    const { media } = renderPlayer()
    advanceTo(media, 20)
    expect(screen.getByRole('button', { name: /Lets get started/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('button', { name: /Welcome to the course/ })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('answers J, K and L on the media element', async () => {
    const { media } = renderPlayer()
    advanceTo(media, 40)

    fireEvent.keyDown(media, { key: 'l' })
    expect(media.currentTime).toBe(50)

    fireEvent.keyDown(media, { key: 'j' })
    expect(media.currentTime).toBe(40)

    fireEvent.keyDown(media, { key: 'k' })
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('does not scrub when a control outside the player is typed into', async () => {
    // The reason the handler lives on the media element and the scrubber rather than on
    // `window`: typing "look" into a field on the same screen must not scrub the video three
    // times. The transcript's follow-playback checkbox stands in for any such field.
    const user = userEvent.setup()
    const { media } = renderPlayer()
    advanceTo(media, 40)

    const checkbox = screen.getByLabelText(labels.followPlayhead)
    checkbox.focus()
    await user.keyboard('l')
    expect(media.currentTime).toBe(40)
  })

  it('continues into the next lesson when one ends', () => {
    const { container, media } = renderPlayer()
    act(() => {
      fireEvent.ended(media)
    })
    const next = container.querySelector('video') as HTMLVideoElement
    expect(next.getAttribute('src')).toBe('media://blob/bb.mp4')
    expect(screen.getByText('Lesson 2 of 3: Setup')).toBeInTheDocument()
  })

  it('exposes the scrubber as a slider with the global position on it', () => {
    const { media } = renderPlayer()
    advanceTo(media, 30)
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuenow', '30')
    expect(slider).toHaveAttribute('aria-valuemax', '360')
    expect(slider).toHaveAttribute('aria-valuetext', '0:30')
  })

  it('collects the transcript covering a clip and hands it back in global seconds', async () => {
    const user = userEvent.setup()
    const onCreateClip = vi.fn()
    const { media } = renderPlayer({ onCreateClip })

    advanceTo(media, 5)
    await user.click(screen.getByRole('button', { name: labels.clipStart }))
    advanceTo(media, 35)
    await user.click(screen.getByRole('button', { name: labels.clipEnd }))

    expect(onCreateClip).toHaveBeenCalledWith({
      startSec: 5,
      endSec: 35,
      // Both cues overlap [5, 35]; the third, at 150 s, does not.
      text: 'Welcome to the course. Lets get started.',
    })
  })

  it('shows the local-processing notice permanently, not as a dismissible hint', () => {
    renderPlayer()
    expect(screen.getByText(labels.localNotice)).toBeInTheDocument()
  })

  it('says so plainly when there is no transcript yet', () => {
    renderPlayer({ cues: [], keyframes: [] })
    expect(screen.getByText(labels.noTranscript)).toBeInTheDocument()
  })

  it('renders an audio element, and no video, for an audio source', () => {
    const { container } = render(
      <MediaPlayer kind="audio" parts={parts} cues={cues} keyframes={[]} labels={labels} />,
    )
    expect(container.querySelector('audio')).not.toBeNull()
    expect(container.querySelector('video')).toBeNull()
  })
})
