/**
 * The shapes that cross the boundary between main (which owns the network fetch — `net.fetch`,
 * the hidden-`BrowserWindow` SPA fallback, `youtube-transcript` — none of which `packages/ingest`
 * may import) and this package's pure parsers (`parse-web.ts`, `parse-youtube.ts`).
 *
 * Both a 'web' and a 'youtube' source store one of these, JSON-encoded, as the blob
 * `sources.blob_sha256` names — exactly the same shape every other source kind already uses
 * (a `text` source's blob is its pasted text; a 'web'/'youtube' source's blob is this envelope).
 * That is what lets the parse job stay on its existing path: read the blob, hand its bytes to
 * `parseDocument(kind, { bytes, fallbackTitle }, ctx)`, no job-schema change required.
 */

/** What main stores for a 'web' source, after fetching (and, when the static HTML was too thin,
 *  re-rendering through a hidden `BrowserWindow`) the page (`docs/spec/05-ingestion-rag.md` §1). */
export interface WebPageEnvelope {
  /** The final URL after redirects — what a relative image `src` or link `href` resolves
   *  against, and what `SourceDoc.meta.origin.url` records for the citation. */
  url: string
  /** ISO 8601, when main fetched (or last re-rendered) the page. */
  fetchedAt: string
  /** The raw HTML main fetched, or the hidden `BrowserWindow`'s rendered `outerHTML`. */
  html: string
  /** True when the static fetch's word count was too thin and a hidden `BrowserWindow`
   *  re-rendered the page instead (the SPA fallback). Carried through for `meta.warnings`. */
  rendered: boolean
}

/** One caption cue, already normalized to seconds regardless of which transcript format
 *  produced it — see `youtube-transcript-normalize.ts` for why that normalization is needed. */
export interface YouTubeTranscriptCue {
  startSec: number
  endSec: number
  text: string
}

/** What main stores for a 'youtube' source, after resolving the video id, fetching its oEmbed
 *  metadata and (when available) its transcript. */
export interface YouTubeEnvelope {
  /** The canonical `https://www.youtube.com/watch?v=<id>` URL, regardless of which shape the
   *  user pasted (`youtu.be/...`, `/shorts/...`, a `list=` playlist entry). */
  url: string
  videoId: string
  fetchedAt: string
  title: string | null
  author: string | null
  thumbnailUrl: string | null
  transcript: YouTubeTranscriptCue[] | null
  /** BCP-47 (or whatever `youtube-transcript` reports), when a transcript was found. */
  transcriptLanguage: string | null
  /** Set when no transcript could be obtained, so the parser can say why instead of silently
   *  emitting a document with no blocks ("sin transcripción disponible: subí el audio"). */
  transcriptUnavailableReason: string | null
  /** Set by `main/library/service.ts` when this video was one entry of a pasted playlist URL
   *  ("one source per video in a collection", `docs/spec/05-ingestion-rag.md` §1) — absent for a
   *  video imported on its own. `fetchYouTubeVideo` itself knows nothing about playlists; the
   *  caller stamps these on afterwards, which is why they are optional here rather than on
   *  `FetchYouTubeVideoDeps`. */
  playlistId?: string
  /** This video's 0-based position in the playlist feed at import time — the grouping a later
   *  "jump to next lesson" feature would need, since nothing else ties a playlist's sources
   *  together or orders them. */
  playlistIndex?: number
}

/**
 * Fetches one image a web page references, for `parseWebPage` to store as an `Asset` via
 * `ctx.putAsset`.
 *
 * Returns `null` to skip it (cross-origin, a tracker pixel, a failed request, a mime the store
 * does not recognise) rather than throwing — a page with one broken image link is a page with
 * one missing figure, not a failed import.
 */
export type WebImageFetcher = (url: string) => Promise<{ bytes: Uint8Array; mime: string } | null>
