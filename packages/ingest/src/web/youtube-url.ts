/**
 * YouTube URL parsing (`docs/spec/05-ingestion-rag.md` §1's "YouTube" row: "URL parser
 * (watch/shorts/playlist)"). Pure string/URL handling — no network, no `youtube-transcript`
 * import — so `main`'s deep-link handler and the "Paste URL" import path can both classify a
 * pasted link the same way before anything is fetched.
 *
 * Reachable at its own `@retenia/ingest/web/youtube-url` export, not just through the `web`
 * barrel: `apps/desktop/src/main/library/service.ts` needs exactly this function to classify a
 * pasted URL, from the *main* process's own dynamic-import graph — which is a different Electron
 * entry point (and a different Rollup build target) than the job worker's. Importing the full
 * `web` barrel there would pull `jsdom`/`defuddle`/`turndown` into a chunk shared between main
 * and the worker, which is what produced a broken bundle (a `node:module` CJS-interop shim
 * emitted mid-file) the one time it was tried — the `web` barrel's own doc comment already warns
 * about this for the worker side; this is the same rule from main's side.
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
