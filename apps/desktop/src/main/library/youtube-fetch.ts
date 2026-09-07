import type { YouTubeEnvelope } from '@retenia/ingest/web'
import { normalizeYouTubeTranscript } from '@retenia/ingest/web/youtube-transcript-normalize'
// The two narrow entries, not the `web` barrel: this file is reachable from main's own bundle, a
// separate Rollup output from the job worker's — importing the full barrel here would pull
// `jsdom`/`defuddle`/`turndown` into a chunk shared across both, which broke the production build
// outright (see `youtube-url.ts`'s own doc comment).
import { canonicalWatchUrl } from '@retenia/ingest/web/youtube-url'
import { net } from 'electron'
import { XMLParser } from 'fast-xml-parser'
import { fetchTranscript, type TranscriptResponse } from 'youtube-transcript'

/**
 * The YouTube importer's fetch step (`docs/spec/05-ingestion-rag.md` §1's "YouTube" row):
 * oEmbed for title/author/thumbnail (no API key), `youtube-transcript` for captions with a
 * es → en → any language preference, and the public playlist RSS feed for "one source per
 * video in a collection". Everything here runs in main, never in `packages/ingest` — the
 * package stays free of `youtube-transcript` and Electron alike, and gets only the JSON
 * envelope this module produces (`@retenia/ingest/web`'s `YouTubeEnvelope`).
 */

const FETCH_TIMEOUT_MS = 15_000
const OEMBED_URL = 'https://www.youtube.com/oembed'
const PLAYLIST_FEED_URL = 'https://www.youtube.com/feeds/videos.xml'
/** oEmbed's JSON is a handful of fields; the playlist Atom feed is longer (one `<entry>` per
 *  video) but still bounded by YouTube's own "most recent entries" cap. Both requests hit a
 *  hardcoded `www.youtube.com` host, so this guards against a compromised/misbehaving YouTube
 *  or an on-path tamperer, not a user-controlled URL — reading either response with
 *  `.json()`/`.text()` had no upper bound at all (`security-reviewer` finding L1). */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

/** Reads a response body up to `maxBytes`, aborting the stream (not just the accumulation) the
 *  moment it is exceeded. Mirrors `web-fetch.ts`'s `readCapped` — duplicated rather than shared
 *  because that module lives beside the SPA-render/SSRF machinery this file has no reason to
 *  import. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error(`response is larger than ${maxBytes} bytes`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/** es → en → any (`docs/spec/05-ingestion-rag.md` §1's stated preference order). */
const LANGUAGE_PREFERENCE = ['es', 'en'] as const

/**
 * Every call in this file passes a plain string URL, so this is deliberately narrower than
 * `typeof fetch`: Electron's `net.fetch` types its `input` parameter as `string | Request`
 * (no `URL`), which is not assignable to the DOM lib's wider `typeof fetch` — so a helper typed
 * against the ambient global would reject `net.fetch` as its default. Both satisfy this one.
 */
type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

interface OEmbedResult {
  title: string | null
  author: string | null
  thumbnailUrl: string | null
}

async function fetchOEmbed(videoId: string, fetchImpl: FetchImpl): Promise<OEmbedResult> {
  const empty: OEmbedResult = { title: null, author: null, thumbnailUrl: null }
  try {
    const url = `${OEMBED_URL}?url=${encodeURIComponent(canonicalWatchUrl(videoId))}&format=json`
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) return empty
    const data = JSON.parse(await readCapped(response, MAX_RESPONSE_BYTES)) as Record<
      string,
      unknown
    >
    return {
      title: typeof data.title === 'string' ? data.title : null,
      author: typeof data.author_name === 'string' ? data.author_name : null,
      thumbnailUrl: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : null,
    }
  } catch {
    // No oEmbed metadata is a source with a less helpful title, never a failed import — the
    // video id and (when one exists) the transcript are what actually matter.
    return empty
  }
}

type FetchTranscript = typeof fetchTranscript

interface TranscriptFound {
  cues: TranscriptResponse[]
  language: string | null
}

/**
 * Tries the transcript in Spanish, then English, then whichever track exists — each language
 * `youtube-transcript` cannot find throws `YoutubeTranscriptNotAvailableLanguageError`, which is
 * exactly the "try the next one" signal.
 *
 * The spec's next fallback after this one — asking the `audio` role's cloud provider (Gemini)
 * for a timestamped transcript straight from the public URL, with an explicit cost estimate and
 * consent, when `youtube-transcript` finds no captions at all — is deliberately not implemented
 * here: that provider layer (roles, cost estimation, consent prompts) is sub-phase 7.x's, and
 * does not exist in this codebase yet (`main/library/service.ts`'s own `textGenerator` is the
 * *text* `cheap` role only). Until then, a video with no captions correctly reports "no
 * transcript is available" (`parseYouTubePage`'s fallback message) rather than silently
 * pretending the feature exists; wiring the Gemini path in is a straightforward addition once
 * 7.x's provider port exists, not a redesign of anything here.
 */
async function fetchTranscriptWithLanguagePreference(
  videoId: string,
  run: FetchTranscript,
  fetchImpl: FetchImpl,
): Promise<TranscriptFound | { reason: string }> {
  // `youtube-transcript` only ever calls `config.fetch` with the plain string URL of a caption
  // track (`track.baseUrl`, read straight from its source) — never a `URL`/`Request` — so this
  // narrower `FetchImpl` is safe here despite the wider `typeof globalThis.fetch` its own type
  // declares. See `FetchImpl`'s own doc comment for why the narrower type exists at all.
  const asLibraryFetch = fetchImpl as unknown as typeof fetch

  for (const lang of LANGUAGE_PREFERENCE) {
    try {
      const cues = await run(videoId, { lang, fetch: asLibraryFetch })
      if (cues.length > 0) return { cues, language: cues[0]?.lang ?? lang }
    } catch {
      // Not available in this language; the next preference (or "any", below) takes over.
    }
  }
  try {
    const cues = await run(videoId, { fetch: asLibraryFetch })
    if (cues.length > 0) return { cues, language: cues[0]?.lang ?? null }
    return { reason: 'This video has no captions track' }
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) }
  }
}

export interface FetchYouTubeVideoDeps {
  fetchImpl?: FetchImpl
  fetchTranscript?: FetchTranscript
}

export async function fetchYouTubeVideo(
  videoId: string,
  deps: FetchYouTubeVideoDeps = {},
): Promise<YouTubeEnvelope> {
  const fetchImpl = deps.fetchImpl ?? net.fetch
  const run = deps.fetchTranscript ?? fetchTranscript

  const [oembed, transcriptResult] = await Promise.all([
    fetchOEmbed(videoId, fetchImpl),
    fetchTranscriptWithLanguagePreference(videoId, run, fetchImpl),
  ])

  const shared = {
    url: canonicalWatchUrl(videoId),
    videoId,
    fetchedAt: new Date().toISOString(),
    title: oembed.title,
    author: oembed.author,
    thumbnailUrl: oembed.thumbnailUrl,
  }

  if ('reason' in transcriptResult) {
    return {
      ...shared,
      transcript: null,
      transcriptLanguage: null,
      transcriptUnavailableReason: transcriptResult.reason,
    }
  }

  const segments = normalizeYouTubeTranscript(
    transcriptResult.cues.map((cue) => ({
      text: cue.text,
      offset: cue.offset,
      duration: cue.duration,
    })),
  )
  return {
    ...shared,
    transcript: segments,
    transcriptLanguage: transcriptResult.language,
    transcriptUnavailableReason: null,
  }
}

export interface PlaylistVideo {
  videoId: string
  title: string
}

export interface FetchYouTubePlaylistResult {
  videos: PlaylistVideo[]
  /** True when the feed's entry count hit `PLAYLIST_FEED_ENTRY_LIMIT` — the signal that more
   *  videos likely exist beyond what this fetch returned (see the function doc comment). Only
   *  ever a lower bound: the feed gives no total count, so this is "at least this many", never a
   *  precise "there are N more". */
  truncated: boolean
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'entry',
})

/** YouTube's public playlist Atom feed has never returned more than this many `<entry>`
 *  elements regardless of the playlist's real size (an undocumented, long-standing limit of the
 *  feed itself, not a `maxResults` this code could raise) — the threshold `truncated` below is
 *  judged against. */
const PLAYLIST_FEED_ENTRY_LIMIT = 15

/**
 * The playlist's videos, from YouTube's public Atom feed — no Data API key, and compliant with
 * the "no yt-dlp" rule (`docs/spec/07-architecture.md`). The one real limitation: this feed
 * only ever lists a playlist's most recent entries (YouTube's own limit, not this code's), so a
 * long-standing playlist imports its latest videos rather than every video it has ever held.
 * Previously only documented in this comment and never actually surfaced anywhere a user could
 * see it; `truncated` is what lets `service.ts` warn instead of silently importing a partial
 * playlist with no indication anything was left out (`reviewer` finding).
 */
export async function fetchYouTubePlaylist(
  playlistId: string,
  deps: { fetchImpl?: FetchImpl } = {},
): Promise<FetchYouTubePlaylistResult> {
  const fetchImpl = deps.fetchImpl ?? net.fetch
  const url = `${PLAYLIST_FEED_URL}?playlist_id=${encodeURIComponent(playlistId)}`
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} fetching playlist "${playlistId}"`)
  }

  const xml = await readCapped(response, MAX_RESPONSE_BYTES)
  const parsed = xmlParser.parse(xml) as {
    feed?: { entry?: Array<Record<string, unknown>> }
  }
  const entries = parsed.feed?.entry ?? []

  const videos: PlaylistVideo[] = []
  for (const entry of entries) {
    const videoId = entry['yt:videoId']
    const title = entry.title
    if (typeof videoId === 'string' && typeof title === 'string') {
      videos.push({ videoId, title })
    }
  }
  return { videos, truncated: entries.length >= PLAYLIST_FEED_ENTRY_LIMIT }
}
