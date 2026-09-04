import { MEDIA_TOKEN_PATTERN, type MediaRef } from '@retenia/activity-schema'
import { MarkdownView } from '@retenia/ui'
import { Fragment, useMemo } from 'react'
import { useActivity } from '../host/activity-context'
import { AudioButton } from './audio-button'

/**
 * The `RichText` of `docs/spec/03-activities.md` §7: Markdown with `$TeX$`, fenced code and
 * `[[media:ID]]` references.
 *
 * Markdown, KaTeX and the syntax-highlighted fenced code come from `@retenia/ui`'s
 * `MarkdownView`, which already sanitizes the HTML tree (no `rehype-raw`) — activity text is
 * model-generated, so it is trusted in *shape* and never in content. The sub-phase brief names
 * CodeMirror for the read-only code block; `MarkdownView` renders fenced code through Shiki
 * (`CodeBlock`), which is the same read-only, highlighted, copyable block with the highlighter the
 * design system already ships, so no second one is pulled in. CodeMirror arrives with the editable
 * code activities of sub-phase 12.4, where an editor is actually needed.
 *
 * What this component adds on top is the media layer: `[[media:ID]]` is resolved against the
 * envelope's `media[]` and rendered as an image, an audio button or a video.
 */

export interface RichTextProps {
  children: string
  /** Overrides the mounted activity's `media[]` — used by the stories and by nested payload text. */
  media?: readonly MediaRef[]
  className?: string
}

type Segment =
  | { key: string; kind: 'text'; text: string }
  | { key: string; kind: 'media'; id: string }

/** Splits on `[[media:ID]]`, keeping the surrounding Markdown intact. `key` is the offset the
 *  segment starts at: stable across renders and unique, without keying on the array index. */
export function splitMediaTokens(source: string): Segment[] {
  const segments: Segment[] = []
  let cursor = 0
  // The pattern is a module-level /g regex; `lastIndex` has to be reset before each scan.
  const pattern = new RegExp(MEDIA_TOKEN_PATTERN.source, 'g')
  let match = pattern.exec(source)
  while (match !== null) {
    if (match.index > cursor) {
      segments.push({ key: `t${cursor}`, kind: 'text', text: source.slice(cursor, match.index) })
    }
    segments.push({ key: `m${match.index}`, kind: 'media', id: match[1] as string })
    cursor = match.index + match[0].length
    match = pattern.exec(source)
  }
  if (cursor < source.length) {
    segments.push({ key: `t${cursor}`, kind: 'text', text: source.slice(cursor) })
  }
  return segments
}

function MediaSlot({ asset }: { asset: MediaRef | undefined }) {
  const { labels, resolveMedia } = useActivity()
  if (!asset) return null
  const src = resolveMedia(asset)
  // `pending_media` (§11): the media job has not produced the asset yet, so there is nothing to
  // show. The session generator keeps such activities out of a session; a story may still hit it.
  if (src === null) {
    return (
      <span className="text-muted text-xs italic" data-testid={`media-pending-${asset.id}`}>
        {labels.audioUnavailable}
      </span>
    )
  }
  if (asset.kind === 'image') {
    return <img src={src} alt={asset.alt ?? ''} className="max-w-full rounded-md" />
  }
  if (asset.kind === 'audio') {
    return <AudioButton src={src} label={asset.alt} />
  }
  // A generated caption track lands with the media pipeline of sub-phase 12.3; until then the
  // transcript is the surrounding prompt text, which is why `alt` is rendered as the fallback.
  return (
    // biome-ignore lint/a11y/useMediaCaption: no caption track exists before sub-phase 12.3
    <video src={src} controls className="max-w-full rounded-md">
      {asset.alt}
    </video>
  )
}

export function RichText({ children, media, className }: RichTextProps) {
  const { activity } = useActivity()
  const refs = media ?? activity.media ?? []
  const segments = useMemo(() => splitMediaTokens(children), [children])

  if (segments.length === 1 && segments[0]?.kind === 'text') {
    return <MarkdownView className={className}>{children}</MarkdownView>
  }

  return (
    <div className={className}>
      {segments.map((segment) => (
        <Fragment key={segment.key}>
          {segment.kind === 'text' ? (
            <MarkdownView>{segment.text}</MarkdownView>
          ) : (
            <MediaSlot asset={refs.find((candidate) => candidate.id === segment.id)} />
          )}
        </Fragment>
      ))}
    </div>
  )
}
