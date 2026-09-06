/**
 * What the media player is handed.
 *
 * Declared here rather than imported from `@retenia/ipc-contract`, because `packages/readers`
 * may depend only on `core` and `ui` (`tooling/scripts/check-deps.mjs`). That boundary is not
 * bureaucracy: it is what keeps the player a *component* — something a Storybook story, a
 * future mobile client or an export preview can render — rather than a view that only works
 * when an Electron main process is on the other end of a bridge. `apps/desktop` maps its DTOs
 * onto these shapes in `features/library/source-media.tsx`.
 *
 * Everything here speaks the source's **global timeline**: a course is one continuous
 * recording as far as its transcript, its citations and its cards are concerned, and the
 * player is the only thing that has to know it is really twelve files
 * (`@retenia/core`'s `toLocal`).
 */

export interface MediaPartRef {
  /** A `media://blob/<sha256>.<ext>` URL the desktop layer built. `readers` never learns what
   *  a blob is. */
  src: string
  mime: string
  title: string
  startSec: number
  durationSec: number | null
}

export interface TranscriptCue {
  id: string
  /** Global seconds. */
  startSec: number
  endSec: number
  text: string
  /** `12:30` — what a citation shows. */
  label: string
}

export interface KeyframeMarker {
  id: string
  timeSec: number
  /** `media://blob/<sha256>.png`. */
  src: string
  /** The OCR text, when there was any — it is what makes the thumbnail's alt text useful. */
  text: string | null
}

/**
 * Every visible string, as a prop.
 *
 * `packages/ui` components take their copy this way and this package follows the rule, so the
 * i18n resources stay in one place (`packages/i18n`, with `pnpm i18n:check` enforcing key
 * parity between `es-AR` and `en`) and a component can be rendered in a story without an
 * i18n provider.
 */
export interface MediaPlayerLabels {
  play: string
  pause: string
  mute: string
  unmute: string
  back: string
  forward: string
  transcript: string
  keyframes: string
  noTranscript: string
  noKeyframes: string
  followPlayhead: string
  clip: string
  clipStart: string
  clipEnd: string
  clipSave: string
  clipCancel: string
  clipHint: string
  /** The permanent local-processing notice. */
  localNotice: string
  partOf: (index: number, total: number, title: string) => string
  frameAt: (label: string) => string
}

export interface ClipSelection {
  startSec: number
  endSec: number
  /** The transcript covering the range, already joined. */
  text: string
}
