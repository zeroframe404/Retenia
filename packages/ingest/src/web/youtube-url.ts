/**
 * YouTube URL parsing (`docs/spec/05-ingestion-rag.md` §1's "YouTube" row: "URL parser
 * (watch/shorts/playlist)"). Pure string/URL handling — no network, no `youtube-transcript`
 * import — so `main`'s deep-link handler and the "Paste URL" import path can both classify a
 * pasted link the same way before anything is fetched.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export type YouTubeUrlKind =
  | { kind: 'video'; videoId: string }
  | { kind: 'playlist'; playlistId: string }

/** Normalizes the handful of hostnames YouTube serves video pages from — `www.`, a bare
 *  `m.` (mobile) or `music.` prefix, none of which change what a path means. */
function normalizedHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^(www|m|music)\./, '')
}

function firstSegment(path: string, prefix: string): string | undefined {
  return path.slice(prefix.length).split('/')[0]
}

/**
 * Classifies a pasted YouTube URL, or returns `null` when it is not one YouTube actually
 * serves a video or playlist from.
 *
 * `/watch?v=<id>&list=<id>` — a video opened from inside a playlist — is a *video* link: the
 * user is looking at that one video, and importing the whole playlist because it happened to be
 * open would surprise them. Only a bare `/playlist?list=<id>` (or `/watch?list=<id>` with no
 * `v`) is a playlist link.
 */
export function parseYouTubeUrl(raw: string): YouTubeUrlKind | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const host = normalizedHost(url)

  if (host === 'youtu.be') {
    const id = firstSegment(url.pathname, '/')
    return id && VIDEO_ID.test(id) ? { kind: 'video', videoId: id } : null
  }

  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null

  const path = url.pathname

  if (path === '/watch') {
    const v = url.searchParams.get('v')
    if (v && VIDEO_ID.test(v)) return { kind: 'video', videoId: v }
    const list = url.searchParams.get('list')
    return list ? { kind: 'playlist', playlistId: list } : null
  }

  if (path.startsWith('/shorts/')) {
    const id = firstSegment(path, '/shorts/')
    return id && VIDEO_ID.test(id) ? { kind: 'video', videoId: id } : null
  }

  if (path.startsWith('/embed/')) {
    const id = firstSegment(path, '/embed/')
    return id && VIDEO_ID.test(id) ? { kind: 'video', videoId: id } : null
  }

  if (path.startsWith('/live/')) {
    const id = firstSegment(path, '/live/')
    return id && VIDEO_ID.test(id) ? { kind: 'video', videoId: id } : null
  }

  if (path === '/playlist') {
    const list = url.searchParams.get('list')
    return list ? { kind: 'playlist', playlistId: list } : null
  }

  return null
}

/** The canonical `https://www.youtube.com/watch?v=<id>` URL for a video, regardless of which
 *  shape it was originally pasted as — what a 'youtube' source's `originUri` is set to. */
export function canonicalWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}
