import type { MediaMetaDto, SourceUnitSummary } from '@retenia/ipc-contract'
import type {
  KeyframeMarker,
  MediaPartRef,
  MediaPlayerLabels,
  TranscriptCue,
} from '@retenia/readers'
import { MediaPlayer } from '@retenia/readers'
import { useMemo } from 'react'
import { useT } from '../../i18n/use-t'
import { useSourceUnits } from './use-library'

/**
 * The connected media player: DTOs in, `@retenia/readers` props out.
 *
 * The mapping lives here rather than in `readers` because that package may import only `core`
 * and `ui` (`tooling/scripts/check-deps.mjs`), which is what keeps the player renderable from
 * a Storybook story with no IPC bridge behind it. Two things are translated here and nowhere
 * else: a blob hash becomes a `media://` URL, and a `source_units` row becomes either a
 * transcript cue or a slide marker.
 *
 * It reads `library.listUnits`, not `library.getSourceDoc`. A twelve-hour course's parsed
 * document is tens of thousands of blocks in a single structured clone, and the player needs
 * only the times.
 */

/** Mirrors `MEDIA_SCHEME`/`MEDIA_BLOB_HOST` in main's protocol handler. Not imported: the
 *  renderer is sandboxed and shares no module with main. */
function mediaUrl(sha256: string, ext: string | null): string {
  return `media://blob/${sha256}${ext === null ? '' : `.${ext}`}`
}

/** `12:30`, matching the label a citation shows. */
function clockLabel(ms: number): string {
  const whole = Math.max(0, Math.floor(ms / 1_000))
  const hours = Math.floor(whole / 3_600)
  const minutes = Math.floor((whole % 3_600) / 60)
  const seconds = whole % 60
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`
}

/** The extension `media://` serves a part under, from its mime. Kept to the media types the
 *  Library can import, because a mime it cannot serve is a source it could not have stored. */
const EXT_BY_MIME: Readonly<Record<string, string>> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/quicktime': 'mov',
}

export interface SourceMediaProps {
  sourceId: string
  kind: 'audio' | 'video'
  media: MediaMetaDto | undefined
  onCreateClip?: (clip: { startSec: number; endSec: number; text: string }) => void
}

export function SourceMedia({ sourceId, kind, media, onCreateClip }: SourceMediaProps) {
  const t = useT('library')
  const units = useSourceUnits(sourceId)

  const parts: MediaPartRef[] = useMemo(
    () =>
      (media?.parts ?? []).map((part) => ({
        src: mediaUrl(part.blobSha256, EXT_BY_MIME[part.mime] ?? null),
        mime: part.mime,
        title: part.title,
        startSec: part.startSec,
        durationSec: part.durationSec,
      })),
    [media],
  )

  const { cues, keyframes } = useMemo(() => {
    const rows: readonly SourceUnitSummary[] = units.data?.units ?? []
    const cueList: TranscriptCue[] = []
    const frameList: KeyframeMarker[] = []

    for (const unit of rows) {
      if (unit.tStartMs === null) continue
      const startSec = unit.tStartMs / 1_000
      if (unit.kind === 'segment') {
        cueList.push({
          id: unit.id,
          startSec,
          // A window with no recorded end runs to the next one; the last runs to the source's
          // end, so the active-cue highlight never blinks off on the final line.
          endSec: unit.tEndMs === null ? startSec + 90 : unit.tEndMs / 1_000,
          text: unit.text ?? '',
          label: unit.label ?? clockLabel(unit.tStartMs),
        })
      } else if (unit.kind === 'keyframe' && unit.blobSha256 !== null) {
        frameList.push({
          id: unit.id,
          timeSec: startSec,
          src: mediaUrl(unit.blobSha256, 'png'),
          text: unit.text,
        })
      }
    }
    cueList.sort((left, right) => left.startSec - right.startSec)
    frameList.sort((left, right) => left.timeSec - right.timeSec)
    return { cues: cueList, keyframes: frameList }
  }, [units.data])

  const labels: MediaPlayerLabels = useMemo(
    () => ({
      play: t('media.play'),
      pause: t('media.pause'),
      mute: t('media.mute'),
      unmute: t('media.unmute'),
      back: t('media.back'),
      forward: t('media.forward'),
      transcript: t('media.transcript'),
      keyframes: t('media.keyframes'),
      noTranscript: t('media.noTranscript'),
      noKeyframes: t('media.noKeyframes'),
      followPlayhead: t('media.followPlayhead'),
      clip: t('media.clip'),
      clipStart: t('media.clipStart'),
      clipEnd: t('media.clipEnd'),
      clipSave: t('media.clipSave'),
      clipCancel: t('media.clipCancel'),
      clipHint: t('media.clipHint'),
      localNotice: t('media.localNotice'),
      partOf: (index, total, title) => t('media.partOf', { index, total, title }),
      frameAt: (label) => t('media.frameAt', { label }),
    }),
    [t],
  )

  if (parts.length === 0) {
    return <p className="text-muted text-sm">{t('media.unavailable')}</p>
  }

  return (
    <MediaPlayer
      kind={kind}
      parts={parts}
      cues={cues}
      keyframes={keyframes}
      labels={labels}
      {...(onCreateClip === undefined ? {} : { onCreateClip })}
    />
  )
}
