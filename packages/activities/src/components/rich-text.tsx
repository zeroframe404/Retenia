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
  /**
   * Render into phrasing content — a `<span>` with paragraphs unwrapped — for a slot that cannot
   * hold a block: a token inside the drag layer's `<button>`, a matched right side, a cell.
   */
  inline?: boolean
  className?: string
}

type Segment =
  | { key: string; kind: 'text'; text: string }
  | { key: string; kind: 'media'; id: string }

/** A half-open `[start, end)` slice of the Markdown source. */
type Range = readonly [start: number, end: number]

/**
 * A fence opener, as CommonMark 4.5 defines one: the character it is made of and how many of
 * them, since a fence is only closed by a run of the same character that is at least as long.
 */
interface Fence {
  char: string
  length: number
}

/**
 * Leading blockquote markers and indentation, stripped before a line is tested for a fence so a
 * fence inside a quote or a list item is still recognized. CommonMark's 3-space limit on a
 * fence's own indentation is deliberately not enforced: over-recognizing a fence only ever makes
 * the scan treat *more* of the source as code, which is the safe direction (see `codeRanges`).
 */
const CONTAINER_PREFIX = /^[ \t>]*/
const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^(`{3,}|~{3,})[ \t]*$/

function fenceOpenedBy(line: string): Fence | null {
  const match = FENCE_OPEN.exec(line.replace(CONTAINER_PREFIX, ''))
  if (!match) return null
  const marker = match[1] as string
  const char = marker[0] as string
  // A backtick fence's info string may not itself contain a backtick (CommonMark 4.5), which is
  // what keeps `` `a``b` `` from reading as an opener.
  if (char === '`' && (match[2] as string).includes('`')) return null
  return { char, length: marker.length }
}

function closesFence(line: string, open: Fence): boolean {
  const match = FENCE_CLOSE.exec(line.replace(CONTAINER_PREFIX, ''))
  if (!match) return false
  const marker = match[1] as string
  return marker[0] === open.char && marker.length >= open.length
}

/**
 * Code spans inside `text`, offset by `base`: a run of N backticks closed by the next run of
 * exactly N (CommonMark 6.1). A run with no matching closer is literal text, so the scan resumes
 * at the run after it rather than swallowing the rest of the document; a candidate span
 * containing a blank line is rejected for the same reason, since a code span cannot cross a
 * paragraph break.
 */
function codeSpanRanges(text: string, base: number): Range[] {
  const ranges: Range[] = []
  const runs = /`+/g
  let open = runs.exec(text)
  while (open !== null) {
    const marker = open[0] as string
    const afterOpen = open.index + marker.length
    runs.lastIndex = afterOpen
    let close = runs.exec(text)
    while (close !== null && (close[0] as string).length !== marker.length) {
      runs.lastIndex = close.index + (close[0] as string).length
      close = runs.exec(text)
    }
    if (close === null || /\n[ \t]*\n/.test(text.slice(afterOpen, close.index))) {
      runs.lastIndex = afterOpen
      open = runs.exec(text)
      continue
    }
    const end = close.index + (close[0] as string).length
    ranges.push([base + open.index, base + end])
    runs.lastIndex = end
    open = runs.exec(text)
  }
  return ranges
}

/**
 * The stretches of `source` that Markdown renders as code — fenced blocks first, then the code
 * spans in whatever is left between them.
 *
 * A `[[media:ID]]` inside one of these is *source text a lesson is quoting*, not a reference to
 * resolve: §7's "code is inert" applies to the media layer too. Ignoring them is also what keeps
 * a fence whole — splitting on a token inside it would hand `MarkdownView` two independent
 * documents, the first with an unterminated fence.
 *
 * This is a scan of the source, not a parse of it: `MarkdownView` owns the `react-markdown`
 * pipeline and takes no plugins, so the tokens cannot be resolved on the mdast from here. Every
 * approximation therefore errs towards calling something code (a media token then renders
 * literally, which is the documented fallback) rather than away from it. The one construct left
 * out is the 4-space indented code block: without a block parser it is indistinguishable from a
 * list-item continuation line, and swallowing a legitimate reference inside a list is the worse
 * of the two mistakes.
 */
function codeRanges(source: string): Range[] {
  const fenced: Range[] = []
  let open: Fence | null = null
  let fenceStart = 0
  let offset = 0

  for (const line of source.split('\n')) {
    const lineEnd = offset + line.length
    if (open === null) {
      const fence = fenceOpenedBy(line)
      if (fence) {
        open = fence
        fenceStart = offset
      }
    } else if (closesFence(line, open)) {
      fenced.push([fenceStart, lineEnd])
      open = null
    }
    offset = lineEnd + 1
  }
  // An unterminated fence runs to the end of the source (CommonMark 4.5).
  if (open !== null) fenced.push([fenceStart, source.length])

  const ranges: Range[] = []
  let cursor = 0
  for (const [start, end] of fenced) {
    ranges.push(...codeSpanRanges(source.slice(cursor, start), cursor), [start, end])
    cursor = end
  }
  ranges.push(...codeSpanRanges(source.slice(cursor), cursor))
  return ranges
}

/** Splits on `[[media:ID]]`, keeping the surrounding Markdown intact and leaving every token
 *  inside code (see `codeRanges`) in the text it belongs to. `key` is the offset the segment
 *  starts at: stable across renders and unique, without keying on the array index. */
export function splitMediaTokens(source: string): Segment[] {
  const segments: Segment[] = []
  const inert = codeRanges(source)
  let cursor = 0
  // The pattern is a module-level /g regex; `lastIndex` has to be reset before each scan.
  const pattern = new RegExp(MEDIA_TOKEN_PATTERN.source, 'g')
  let match = pattern.exec(source)
  while (match !== null) {
    const from = match.index
    const to = from + (match[0] as string).length
    if (!inert.some(([start, end]) => from < end && start < to)) {
      if (from > cursor) {
        segments.push({ key: `t${cursor}`, kind: 'text', text: source.slice(cursor, from) })
      }
      segments.push({ key: `m${from}`, kind: 'media', id: match[1] as string })
      cursor = to
    }
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

export function RichText({ children, media, inline = false, className }: RichTextProps) {
  const { activity } = useActivity()
  const refs = media ?? activity.media ?? []
  const segments = useMemo(() => splitMediaTokens(children), [children])

  if (segments.length === 1 && segments[0]?.kind === 'text') {
    return (
      <MarkdownView inline={inline} className={className}>
        {children}
      </MarkdownView>
    )
  }

  const Wrapper = inline ? 'span' : 'div'
  return (
    <Wrapper className={className}>
      {segments.map((segment) => (
        <Fragment key={segment.key}>
          {segment.kind === 'text' ? (
            <MarkdownView inline={inline}>{segment.text}</MarkdownView>
          ) : (
            <MediaSlot asset={refs.find((candidate) => candidate.id === segment.id)} />
          )}
        </Fragment>
      ))}
    </Wrapper>
  )
}

/**
 * The same source reduced to a readable line of prose, for the places that need a *string*: an
 * `aria-label`, and the drag layer's live region.
 *
 * Those two cannot take the rendered form — `aria-label` is a plain-text attribute and a live
 * region is read out as text — and they must not take the raw source either, or a screen reader
 * announces *"«$H_2O$» picked up"* and a Remove button is named *"Remove: **She**"*. So the
 * markup is stripped: `[[media:ID]]` references and fenced code drop out entirely (there is no
 * prose in them to read), `![alt](…)`/`[text](…)` keep their visible half, and the delimiters of
 * code spans, math and emphasis are removed while their content stays.
 *
 * It is a reduction, not a parse: it never has to be *exactly* what `MarkdownView` draws, only
 * the same words in the same order, which is what an accessible name has to match (WCAG 2.5.3).
 * Anything it fails to recognize survives as literal text — the safe direction, since the result
 * is only ever read out.
 */
export function toPlainText(source: string): string {
  return (
    source
      .replace(new RegExp(MEDIA_TOKEN_PATTERN.source, 'g'), ' ')
      .replace(/(^|\n)[ \t]*(`{3,}|~{3,}).*(?:\n[\s\S]*?\2[ \t]*)?(?=\n|$)/g, ' ')
      .replace(/`+([^`]*)`+/g, '$1')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
      .replace(/\$([^$\n]*)\$/g, '$1')
      // Paired markers only, and underscores only where Markdown itself would emphasize — at a
      // word boundary — so an intra-word `_` (`H_2O`, `snake_case`) is left where it is.
      .replace(/(\*\*\*|\*\*|~~|\*)(?=\S)([\s\S]*?\S)\1/g, '$2')
      .replace(/(^|[^\w\\])(___|__|_)(?=\S)([\s\S]*?\S)\2(?!\w)/g, '$1$3')
      .replace(/^[ \t]*(?:[>#]+|[*+-]|\d+\.)[ \t]*/gm, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}
