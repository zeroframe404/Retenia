import { detectLanguage } from '../detect-language'
import { transcriptBlocks } from '../media/blocks'
import type { ParseContext } from '../parse-context'
import type { ParseInput } from '../parse-input'
import type { Asset, Section, SourceDoc } from '../source-doc'
import type { YouTubeEnvelope } from './types'

/**
 * The YouTube importer's parser (sub-phase 6.5, `docs/spec/05-ingestion-rag.md` §1's "YouTube"
 * row). Like `parse-web.ts`, `input.bytes` is a JSON envelope main wrote after resolving the
 * video (oEmbed metadata, a transcript when one exists) — never the video itself, which this
 * package never touches.
 *
 * The transcript becomes timed blocks via `media/blocks.ts`'s `transcriptBlocks` — the same
 * function sub-phase 6.4's audio/video pipeline uses — which is what makes a 'youtube' document
 * a transcript to 6.2's chunker (`chunking/transcript.ts`'s `isTranscript`) with no changes on
 * that side: the contract is one field wide, a block with a numeric `locator.timeSec`.
 *
 * Scope note: the spec's "embedded player (YouTube iframe API) with clickable transcript
 * (seek)" is deliberately not built in this sub-phase. This module gives that future player
 * everything it would need — `meta.origin.videoId` to embed, and transcript blocks whose
 * `locator.timeSec` is exactly the seek target a click would use, the same shape sub-phase
 * 6.4's audio/video player already seeks by — but the player component itself, and wiring it
 * into `source-detail.tsx` (whose `isMedia` check excludes `'youtube'` today), is UI work with
 * no parser-side dependency and belongs with the rest of sub-phase 6.5's UI follow-ups, not
 * bundled into the importer.
 */

const NO_TRANSCRIPT_FALLBACK =
  'sin transcripción disponible: subí el audio (no transcript is available; upload the audio)'

export interface ParseYouTubePageDeps {
  /** Downloads the oEmbed thumbnail, for a `thumbnail` asset. Best-effort: a failed or missing
   *  thumbnail is a source with no preview image, never a failed import. */
  fetchThumbnail?: (url: string) => Promise<{ bytes: Uint8Array; mime: string } | null>
}

const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024

/** Hosts oEmbed is ever expected to hand back a thumbnail on. `envelope.thumbnailUrl` is not
 *  user-controlled the way a pasted web URL is — it comes from YouTube's own oEmbed response —
 *  but nothing upstream of this function pins its scheme or host either, so a compromised or
 *  spoofed oEmbed response would otherwise be fetched exactly like a trusted one
 *  (`security-reviewer` finding M4). */
const ALLOWED_THUMBNAIL_HOST_SUFFIXES = ['.ytimg.com', '.youtube.com', '.googleusercontent.com']

export function isAllowedThumbnailUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  return ALLOWED_THUMBNAIL_HOST_SUFFIXES.some(
    (suffix) => host === suffix.slice(1) || host.endsWith(suffix),
  )
}

export async function defaultFetchThumbnail(
  url: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!isAllowedThumbnailUrl(url)) return null

  try {
    // `redirect: 'manual'`, exactly as `parse-web.ts`'s `createDefaultImageFetcher` now does: the
    // host allowlist above only ever validates the *original* URL, so following a redirect would
    // let it land anywhere — the allowlist would exist in name only (`security-reviewer` finding
    // "New-3"). The thumbnail is best-effort already (`catch` below returns `null`, never fails
    // the import), so refusing a redirect outright costs nothing worse than a missing preview.
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(10_000),
      redirect: 'manual',
    })
    if (!response.ok || response.body === null) return null

    // Streamed and capped exactly like `parse-web.ts`'s `createDefaultImageFetcher`: the whole
    // point of a byte cap is to never hold more than that much of an untrusted body in memory,
    // which reading the full body with `arrayBuffer()` first and checking its length afterward
    // does not accomplish.
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_THUMBNAIL_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg'
    return { bytes, mime }
  } catch {
    return null
  }
}

export async function parseYouTubePage(
  input: ParseInput,
  ctx: ParseContext,
  deps: ParseYouTubePageDeps = {},
): Promise<SourceDoc> {
  const envelope = JSON.parse(new TextDecoder().decode(input.bytes)) as YouTubeEnvelope
  const fetchThumbnail = deps.fetchThumbnail ?? defaultFetchThumbnail
  const warnings: string[] = []

  const blocks =
    envelope.transcript !== null && envelope.transcript.length > 0
      ? transcriptBlocks({
          segments: envelope.transcript.map((cue) => ({
            startSec: cue.startSec,
            endSec: cue.endSec,
            text: cue.text,
          })),
          offsetSec: 0,
          id: ctx.id,
        })
      : []

  if (blocks.length === 0) {
    warnings.push(envelope.transcriptUnavailableReason ?? NO_TRANSCRIPT_FALLBACK)
  }

  const assets: Asset[] = []
  if (envelope.thumbnailUrl !== null) {
    const fetched = await fetchThumbnail(envelope.thumbnailUrl)
    if (fetched !== null) {
      assets.push(await ctx.putAsset(fetched.bytes, fetched.mime, 'thumbnail'))
    }
  }

  const title = envelope.title ?? input.fallbackTitle
  const section: Section = {
    id: ctx.id(),
    title,
    level: 1,
    blocks: blocks.map((block) => block.id),
    children: [],
  }

  const language =
    envelope.transcriptLanguage ?? detectLanguage(blocks.map((block) => block.text).join(' '))

  return {
    id: ctx.id(),
    kind: 'youtube',
    title,
    language,
    sections: [section],
    blocks,
    assets,
    meta: {
      warnings,
      origin: {
        url: envelope.url,
        fetchedAt: envelope.fetchedAt,
        ...(envelope.author !== null ? { author: envelope.author } : {}),
        videoId: envelope.videoId,
        ...(envelope.playlistId !== undefined ? { playlistId: envelope.playlistId } : {}),
        ...(envelope.playlistIndex !== undefined ? { playlistIndex: envelope.playlistIndex } : {}),
      },
    },
  }
}
