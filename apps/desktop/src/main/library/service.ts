import { createReadStream } from 'node:fs'
import { basename, join } from 'node:path'
import type { TextGenerator } from '@retenia/ai'
import type {
  AbortSignalLike,
  Annotation,
  AnnotationKind,
  BlobPutResult,
  BlobStore,
  Chunk,
  Job,
  JobScheduler,
  JsonObject,
  ListOptions,
  Source,
  SourceStatus,
  SourceUnit,
  UnitOfWork,
} from '@retenia/core'
import { CARD_STATE } from '@retenia/core'
import type {
  ContextualizationEstimate,
  DocumentContext,
  SourceDoc,
  TokenizerId,
} from '@retenia/ingest'
import type { WebPageEnvelope, YouTubeEnvelope } from '@retenia/ingest/web'
import type { ChunkDraftsBlob, IngestChunkResult } from '../../jobs/ingest-chunk'
import type { IngestParseResult } from '../../jobs/ingest-parse'
import { persistChunkDrafts } from './chunk-store'
import { detectSource } from './detect-kind'
import { buildItemLocatorFromChunk } from './item-locator'
import type { PlaylistVideo } from './youtube-fetch'

/**
 * The source library: importing a file or pasted text, watching it through
 * `ingestParseSource` and then `ingestChunkSource`, and reading back what they found
 * (sub-phases 6.1 and 6.2).
 *
 * Mirrors `main/memory/optimizer-service.ts`'s shape — a job the worker runs, a main-process
 * service that owns applying its result — with one difference: an optimization needs a
 * human's "apply" decision (§16's health check can reject it), so that step is a separate,
 * explicit call. A parse has no such judgement to make; `onJobSettled` applies it the moment
 * the job the runner reports it, with no user action in between.
 */

const PARSE_JOB_KIND = 'ingestParseSource'
/** Headings past this are a table of contents, not the shape of the document. */
const DOCUMENT_OUTLINE_ENTRIES = 60
const CHUNK_JOB_KIND = 'ingestChunkSource'
/** How much of a chunk stands in for a question when the user gave none and the chunk has no
 *  heading path either. Long enough to recognise, short enough not to be the answer. */
const CARD_FRONT_FALLBACK_CHARS = 120

export interface LibraryService {
  /** A file main itself located (the native Open dialog) — the only path-based entry point. */
  addFromFile(path: string, originalName?: string): Promise<Source>
  /** A file the renderer holds (drag-and-drop): its bytes and name, never a path — main
   *  does not open files the renderer names. */
  addFromBytes(name: string, bytes: Uint8Array): Promise<Source>
  /** A folder of lectures as ONE source, with the folder tree as its outline (sub-phase 6.4). */
  addCourseFromFolder(folder: string): Promise<{
    source: Source
    fileCount: number
    skipped: string[]
    truncated: boolean
  }>
  addFromText(text: string, title: string): Promise<Source>
  /**
   * A pasted URL (sub-phase 6.5): fetches the page (or the video's oEmbed metadata and
   * transcript) in main, stores the result as the source's blob, and queues its parse exactly
   * like every other kind. `sources` holds more than one entry only for a YouTube playlist URL
   * — "one source per video in a collection" — a single page or video always returns one.
   * `truncated` is `true` only for a playlist whose public feed hit its own entry limit
   * (`fetchYouTubePlaylist`'s `PLAYLIST_FEED_ENTRY_LIMIT`) — a long-standing playlist's older
   * videos were left out, which the caller should tell the user rather than silently importing a
   * partial collection.
   */
  addFromUrl(url: string): Promise<{ sources: Source[]; truncated: boolean }>
  /** Re-enqueues the same parse for a `failed` (or stuck) source. */
  retry(sourceId: string): Promise<Source>
  list(options?: { statuses?: SourceStatus[] } & ListOptions): Promise<Source[]>
  get(id: string): Promise<Source | undefined>
  /** The parser's own output, once ready — `undefined` before the first successful parse. */
  getDoc(id: string): Promise<SourceDoc | undefined>
  /** The source's chunks in reading order, once it has been chunked. */
  getChunks(id: string): Promise<Chunk[]>
  /** The source's citable units (pages, slides, sections, transcript windows). */
  getUnits(id: string): Promise<SourceUnit[]>
  /**
   * What the "índice mejorado" toggle would cost for this source, before it is switched on
   * (`docs/spec/05-ingestion-rag.md` §4.2). Counts only the chunks that do not have a context
   * yet, so a resumed run quotes what is left rather than the whole book again.
   *
   * The estimate needs no AI provider — it is arithmetic over the chunks and a price table —
   * which is why it is here while the pass itself waits for sub-phase 7.1 to supply a
   * `TextGenerator` for the `cheap` role.
   */
  estimateContextualization(id: string): Promise<ContextualizationEstimate>
  /**
   * Runs the contextual-retrieval pass over the chunks that have no context yet and stores
   * what comes back (`docs/spec/05-ingestion-rag.md` §4.2). Throws
   * `ContextualizationUnavailableError` when no `TextGenerator` is configured, which is the
   * case until sub-phase 7.1 wires a provider to the `cheap` role.
   */
  contextualize(
    id: string,
    options?: { signal?: AbortSignalLike; onProgress?: (done: number, total: number) => void },
  ): Promise<{ written: number; failed: number }>
  /**
   * Re-chunks every source whose chunks were cut under a different `chunking_version` — the
   * reindex sweep of sub-phase 6.2, run once at startup. Returns the sources it queued.
   *
   * Enqueued rather than done inline: re-chunking a library is minutes of CPU, and the queue
   * is what makes it resumable, cancellable and visible.
   */
  rechunkStaleSources(tokenizer?: TokenizerId): Promise<string[]>
  /**
   * "Crear tarjeta desde este fragmento" (sub-phase 6.3): one knowledge item and its first
   * card, made from a chunk and pointing back at it.
   *
   * The chunk text is the *answer*. A card whose front is a passage and whose back is the
   * same passage tests nothing — `docs/spec/01-decisions.md` §7's first principle is that
   * everything ends in active recall — so the question is the user's, and the heading path is
   * only the fallback when they gave none from a result list.
   */
  /** "Crear tarjeta desde este fragmento", for a selected time range (sub-phase 6.4). */
  createCardFromClip(input: {
    sourceId: string
    startSec: number
    endSec: number
    front?: string
    back?: string
  }): Promise<{ itemId: string; cardId: string }>
  createCardFromChunk(input: {
    chunkId: string
    front?: string
    back?: string
  }): Promise<{ itemId: string; cardId: string }>
  remove(id: string): Promise<void>
  /** Wired into `createJobRunner`'s `onSettled`; a no-op for any job that is not one of ours. */
  onJobSettled(job: Job): Promise<void>

  // --- annotations and reading progress (sub-phase 6.6) ---

  /** A source's highlights/notes/regions/clips, oldest first — what the reader restores on
   *  open. */
  listAnnotations(sourceId: string): Promise<Annotation[]>
  /** The selection toolbar's "Resaltar": persists a highlight so it survives a restart and
   *  can become a card later. */
  createAnnotation(input: {
    sourceId: string
    unitId?: string
    kind: AnnotationKind
    anchor: JsonObject
    quote?: string
    note?: string
    color?: string
  }): Promise<Annotation>
  /** Editing a highlight's note or color; the anchor itself never changes. */
  updateAnnotation(input: {
    id: string
    note?: string | null
    color?: string | null
  }): Promise<Annotation>
  /** Soft-deletes the annotation. A card already made from it keeps `annotationId` as
   *  provenance — not a live join. */
  deleteAnnotation(id: string): Promise<void>
  /**
   * The selection toolbar's "Crear tarjeta": a new knowledge item and its first card, made
   * from a highlight and pointing back at it via `annotationId` — the same shape
   * `createCardFromChunk`/`createCardFromClip` use, so "ver en la fuente" works identically
   * whichever way the card was made.
   */
  createCardFromAnnotation(input: {
    annotationId: string
    front?: string
    back?: string
  }): Promise<{ itemId: string; cardId: string }>
  /** Written on every page turn/section change so the reader (and Home's "Continuar donde
   *  estaba") can resume exactly where the user left off. */
  recordProgress(sourceId: string, locator: JsonObject): Promise<void>
  /** The most recently opened sources, most recent first. */
  listRecentlyOpened(limit?: number): Promise<Source[]>
}

export interface LibraryServiceOptions {
  repos: UnitOfWork
  blobStore: BlobStore
  scheduler: JobScheduler
  /**
   * The `cheap` role, for the contextual-retrieval pass. Optional, and absent today: the
   * provider layer lands in sub-phase 7.1, and the call has to be made *here* rather than in a
   * queue worker because API keys live in main's `safeStorage` and nowhere else.
   */
  textGenerator?: TextGenerator
  /**
   * Test seams for `addFromUrl` (sub-phase 6.5). The real `net.fetch`/`BrowserWindow`- and
   * `youtube-transcript`-backed implementations (`./web-fetch`, `./youtube-fetch`) are loaded
   * lazily when these are absent, for the same reason `contextualize`'s prompt loader is a
   * dynamic import: this file must not evaluate Electron, or a network/transcript library,
   * merely because some *other* method on this service was called.
   */
  fetchWebPage?: (
    url: string,
  ) => Promise<{ url: string; html: string; fetchedAt: string; rendered: boolean }>
  fetchYouTubeVideo?: (videoId: string) => Promise<YouTubeEnvelope>
  fetchYouTubePlaylist?: (playlistId: string) => Promise<{
    videos: PlaylistVideo[]
    truncated: boolean
  }>
  /**
   * `EmbeddingService.embedSource`, called once a source's chunk job succeeds. Optional and a
   * plain callback rather than the whole service, for the same reason the fetch seams above
   * are: this file has no business depending on `./embedding-service`'s own dependencies
   * (the model host) merely to enqueue a job.
   *
   * Without this, a freshly imported source sat "ready" with real chunks and no vectors until
   * the *next app start*'s reindex sweep found it — the only other place anything ever called
   * `embedSource` — so hybrid search silently answered from BM25 alone for a whole session.
   */
  embedSource?: (sourceId: string) => Promise<void>
}

/** Thrown by `contextualize` when there is no provider to ask. Its own class so the IPC layer
 *  can turn it into "not configured yet" rather than an unexplained failure. */
/** A folder the user picked that holds no audio or video at all. Its own error so the dialog
 *  can say "no media here" rather than reporting an empty import as a success. */
export class EmptyCourseFolderError extends Error {
  constructor(readonly folder: string) {
    super(`"${folder}" contains no audio or video files`)
    this.name = 'EmptyCourseFolderError'
  }
}

/** A pasted YouTube playlist URL whose public feed listed no videos — either a genuinely empty
 *  playlist, or a private one the feed will not serve. Its own error for the same reason
 *  `EmptyCourseFolderError` is: "no videos here" rather than a silently successful empty
 *  import. */
export class EmptyYouTubePlaylistError extends Error {
  constructor(readonly playlistId: string) {
    super(`Playlist "${playlistId}" has no videos, or is private`)
    this.name = 'EmptyYouTubePlaylistError'
  }
}

export class ContextualizationUnavailableError extends Error {
  constructor() {
    super('No AI provider is configured for the "cheap" role yet')
    this.name = 'ContextualizationUnavailableError'
  }
}

/** A quick, best-effort title from a fetched page's own `<title>`, so a web source's card
 *  shows something better than the raw URL while its parse is still pending — `parse-web.ts`'s
 *  own, more careful extraction is what `library.getSourceDoc` shows once it is ready, but
 *  `sources.title` is set once at import and (like every other kind's) never rewritten after. */
function titleFromHtml(html: string): string | undefined {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html)
  const raw = match?.[1]?.trim()
  if (!raw) return undefined
  const decoded = raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
  return decoded.length > 0 ? decoded : undefined
}

/**
 * Which extension the blob store wrote a source's file under. `BlobStore.put` names the
 * file `<sha256>.<ext>` from the mime, and the worker reads it back through
 * `blobStore.path(sha256, ext)` — so the ext has to travel with the source, or a retry has
 * no way to find the file. It lives in `sources.meta` from the moment of import; the parse
 * result is merged on top later (`onJobSettled`), never written over it.
 */
function blobExtOf(source: Source): string | null {
  const ext = source.meta?.blobExt
  return typeof ext === 'string' ? ext : null
}

/** `12:30` / `1:02:30` — the same shape `timestampLabel` gives a transcript window, so a
 *  clip's citation reads like every other media citation. */
function timeLabel(ms: number): string {
  const whole = Math.max(0, Math.floor(ms / 1_000))
  const hours = Math.floor(whole / 3_600)
  const minutes = Math.floor((whole % 3_600) / 60)
  const seconds = whole % 60
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`
}

/**
 * The `knowledge_items.locator` a highlight's own card carries — same ad-hoc shape
 * `createCardFromChunk`/`createCardFromClip` write (a page/label pair or a time range,
 * `blockIds` always present even when empty), so whatever eventually reads a card's locator
 * for "ver en la fuente" (`retenia://source/<id>?page=…`/`?cfi=…`) does not need a third case
 * just for annotations. `anchor` is validated at the IPC boundary
 * (`annotationAnchorSchema`) — read defensively here anyway, since nothing stops a future
 * importer from writing a row this service did not validate itself.
 */
function annotationLocatorOf(annotation: Annotation): JsonObject {
  const anchor = annotation.anchor
  const page = typeof anchor.page === 'number' ? anchor.page : undefined
  const cfi = typeof anchor.cfi === 'string' ? anchor.cfi : undefined
  return {
    annotationId: annotation.id,
    ...(page === undefined ? {} : { page, label: `p. ${page}` }),
    ...(cfi === undefined ? {} : { selector: cfi }),
    blockIds: [],
  }
}

export function createLibraryService({
  repos,
  blobStore,
  scheduler,
  textGenerator,
  fetchWebPage: fetchWebPageOverride,
  fetchYouTubeVideo: fetchYouTubeVideoOverride,
  fetchYouTubePlaylist: fetchYouTubePlaylistOverride,
  embedSource,
}: LibraryServiceOptions): LibraryService {
  const resolveFetchWebPage = async (url: string) => {
    if (fetchWebPageOverride !== undefined) return fetchWebPageOverride(url)
    const { fetchWebPage } = await import('./web-fetch')
    return fetchWebPage(url)
  }
  const resolveFetchYouTubeVideo = async (videoId: string) => {
    if (fetchYouTubeVideoOverride !== undefined) return fetchYouTubeVideoOverride(videoId)
    const { fetchYouTubeVideo } = await import('./youtube-fetch')
    return fetchYouTubeVideo(videoId)
  }
  const resolveFetchYouTubePlaylist = async (playlistId: string) => {
    if (fetchYouTubePlaylistOverride !== undefined) return fetchYouTubePlaylistOverride(playlistId)
    const { fetchYouTubePlaylist } = await import('./youtube-fetch')
    return fetchYouTubePlaylist(playlistId)
  }

  const enqueueParse = (source: Source): Promise<Job> =>
    scheduler.enqueue(
      PARSE_JOB_KIND,
      {
        sourceId: source.id,
        // `blobSha256`/`kind` are validated non-null by `addFromFile`/`addFromText`/`retry`
        // before this is ever called — every source this service creates has both.
        blobSha256: source.blobSha256 as string,
        ext: blobExtOf(source),
        kind: source.kind,
        title: source.title,
        // Sub-phase 6.4: a course folder is one source made of many files, and
        // `sources.blob_sha256` can hold only the first of them. Durations and timeline
        // offsets are not knowable without ffprobe, so what is written at import is the
        // ordered part list *without* them; the job probes and returns the completed one.
        ...(mediaPartsOf(source) === undefined ? {} : { parts: mediaPartsOf(source) }),
      },
      { subjectId: source.id },
    )

  const enqueueChunk = (
    sourceId: string,
    sourceDocBlobSha256: string,
    tokenizer?: TokenizerId,
  ): Promise<Job> =>
    scheduler.enqueue(
      CHUNK_JOB_KIND,
      { sourceId, sourceDocBlobSha256, ...(tokenizer === undefined ? {} : { tokenizer }) },
      { subjectId: sourceId },
    )

  /** The ordered media files a source is made of, as written at import (sub-phase 6.4). */
  const mediaPartsOf = (source: Source): JsonObject[] | undefined => {
    const parts = (source.meta as { mediaParts?: unknown } | null)?.mediaParts
    return Array.isArray(parts) && parts.length > 0 ? (parts as JsonObject[]) : undefined
  }

  /** The `SourceDoc` blob a source was last parsed into, if it has been parsed at all. */
  const sourceDocBlobOf = (source: Source | undefined): string | undefined => {
    const sha256 = (source?.meta as { sourceDocBlobSha256?: string } | null)?.sourceDocBlobSha256
    return typeof sha256 === 'string' ? sha256 : undefined
  }

  /**
   * The prompt file, read once.
   *
   * `loadContextualizePrompt` is a synchronous `readFileSync`, and both callers below run on
   * main's own thread in response to an IPC call — clicking between two large sources should
   * not put file I/O on the UI thread once per click, let alone once per chunk.
   */
  let prompt: { template: string; system: string; version: string } | undefined
  const contextualizePrompt = async (): Promise<NonNullable<typeof prompt>> => {
    if (prompt !== undefined) return prompt
    const { systemFromTemplate } = await import('@retenia/ingest/contextualize')
    const { loadContextualizePrompt, readPromptVersion } = await import('@retenia/ingest/prompts')
    const template = loadContextualizePrompt()
    prompt = {
      template,
      system: systemFromTemplate(template),
      version: readPromptVersion(template),
    }
    return prompt
  }

  /**
   * What the model is told the document is, built from the `chunks` rows alone.
   *
   * Deliberately *not* from the parsed `SourceDoc`: that is a blob read plus a `JSON.parse` of
   * a whole book, on main's thread, to recover a heading list the chunk rows already carry a
   * copy of. The outline it yields is also the truer one — it describes what was chunked.
   */
  const describeChunked = async (
    source: Source | undefined,
    chunks: readonly Chunk[],
  ): Promise<DocumentContext> => {
    const { buildOutlineFromHeadingPaths, describeDocument } = await import(
      '@retenia/ingest/contextualize'
    )
    const context = describeDocument(
      {
        title: source?.title ?? '',
        kind: source?.kind ?? 'text',
        language: source?.language ?? null,
      },
      chunks,
    )
    return {
      ...context,
      outline: buildOutlineFromHeadingPaths(
        chunks.map((chunk) => chunk.headingPath),
        DOCUMENT_OUTLINE_ENTRIES,
      ),
    }
  }

  const loadDoc = async (source: Source | undefined): Promise<SourceDoc | undefined> => {
    const sha256 = sourceDocBlobOf(source)
    if (sha256 === undefined) return undefined
    const bytes = await blobStore.get(sha256, 'json')
    return JSON.parse(new TextDecoder().decode(bytes)) as SourceDoc
  }

  /**
   * Registers `put`'s row in the SQLite index over the content-addressed store
   * (`docs/spec/07-architecture.md` §5: `blobs` is that index; `blobStore` is what actually
   * holds the bytes). `sources.blob_sha256` carries a real foreign key to `blobs.sha256`, so a
   * `sources` row referencing a blob can never be created before this runs.
   *
   * `blobStore.put` already dedupes identical bytes on disk; this dedupes the same sha
   * against the table, tolerating a second caller racing to register the same one (the
   * content-addressed store's own dedupe means that race is between two *registrations*, not
   * two writes).
   */
  const ensureBlobRegistered = async (
    put: BlobPutResult,
    originalName: string | null,
  ): Promise<void> => {
    if ((await repos.blobs.findBySha256(put.sha256)) !== undefined) return
    try {
      await repos.blobs.create({
        sha256: put.sha256,
        mime: put.mime,
        bytes: put.bytes,
        ext: put.ext,
        originalName,
        meta: null,
      })
    } catch (error) {
      if ((await repos.blobs.findBySha256(put.sha256)) === undefined) throw error
    }
  }

  const addBytes = async (
    bytes: Uint8Array,
    mime: string,
    kind: Source['kind'],
    title: string,
    originUri: string | null,
  ): Promise<Source> =>
    addStored(await blobStore.put(bytes, mime), kind, title, originUri, undefined)

  /** Creates the `sources` row for an already-stored blob and queues its parse. */
  const addStored = async (
    put: Awaited<ReturnType<typeof blobStore.put>>,
    kind: Source['kind'],
    title: string,
    originUri: string | null,
    mediaParts: JsonObject[] | undefined,
  ): Promise<Source> => {
    await ensureBlobRegistered(put, title)
    const source = await repos.sources.create({
      kind,
      title,
      originUri,
      blobSha256: put.sha256,
      status: 'pending',
      language: null,
      meta: { blobExt: put.ext, ...(mediaParts === undefined ? {} : { mediaParts }) },
      error: null,
      ingestedAt: null,
      embeddingStatus: 'pending',
      embeddingModelId: null,
      embeddingError: null,
      lastLocator: null,
      lastOpenedAt: null,
    })
    await enqueueParse(source)
    return source
  }

  return {
    addFromFile: async (path, originalName) => {
      const name = originalName ?? basename(path)
      const { kind, mime } = detectSource(name)
      // Streamed rather than read whole. Sub-phase 6.1's sources topped out at a scanned book;
      // a lecture recording is routinely a gigabyte, and `readFile` would put all of it on
      // main's heap on the way to a store that hashes it in chunks anyway.
      const put = await blobStore.put(createReadStream(path), mime)
      return addStored(put, kind, name, `file://${path}`, undefined)
    },

    /**
     * A course folder as one source (sub-phase 6.4).
     *
     * One `sources` row, not one per lecture: the acceptance criterion asks for it, and it is
     * what makes the folder tree usable as an outline. Every file becomes a *part* laid end to
     * end on a virtual timeline, so a citation into lesson twelve is a single number rather
     * than a file plus an offset.
     */
    addCourseFromFolder: async (folder) => {
      const { walkCourseFolder } = await import('./course')
      const walk = await walkCourseFolder(folder)
      if (walk.parts.length === 0) {
        throw new EmptyCourseFolderError(basename(folder))
      }

      const stored: JsonObject[] = []
      let first: Awaited<ReturnType<typeof blobStore.put>> | undefined
      for (const part of walk.parts) {
        const { mime } = detectSource(part.relPath)
        const put = await blobStore.put(createReadStream(join(folder, part.relPath)), mime)
        first ??= put
        stored.push({
          blobSha256: put.sha256,
          ext: put.ext,
          mime: put.mime,
          title: part.title,
          sectionPath: [...part.sectionPath],
          ordinal: part.ordinal,
        })
      }

      // Every lecture in a course is the same medium; the first one decides the source's kind.
      const { kind } = detectSource(walk.parts[0]?.relPath ?? '')
      const source = await addStored(
        first as NonNullable<typeof first>,
        kind,
        basename(folder),
        `file://${folder}`,
        stored,
      )
      return {
        source,
        fileCount: walk.parts.length,
        skipped: walk.skipped,
        truncated: walk.truncated,
      }
    },

    addFromBytes: async (name, bytes) => {
      const { kind, mime } = detectSource(name)
      return addBytes(bytes, mime, kind, name, null)
    },

    addFromText: async (text, title) =>
      addBytes(new TextEncoder().encode(text), 'text/plain', 'text', title, null),

    addFromUrl: async (url) => {
      // The narrower `web/youtube-url` entry, not the `web` barrel: this file is reachable from
      // main's own bundle, a separate Rollup output from the job worker's — importing the full
      // barrel here would pull `jsdom`/`defuddle`/`turndown` into a chunk shared across both,
      // which broke the production build outright (see `youtube-url.ts`'s own doc comment).
      const { parseYouTubeUrl } = await import('@retenia/ingest/web/youtube-url')
      const youtube = parseYouTubeUrl(url)

      const addYouTubeVideo = async (
        videoId: string,
        fallbackTitle?: string,
        playlist?: { playlistId: string; playlistIndex: number },
      ): Promise<Source> => {
        const fetched = await resolveFetchYouTubeVideo(videoId)
        // `fetchYouTubeVideo` knows nothing about playlists — it resolves one video id in
        // isolation — so the playlist provenance ("one source per video in a collection",
        // `docs/spec/05-ingestion-rag.md` §1) is stamped on here, the one place that knows
        // both the video and which playlist entry produced it.
        const envelope: YouTubeEnvelope =
          playlist === undefined ? fetched : { ...fetched, ...playlist }
        const bytes = new TextEncoder().encode(JSON.stringify(envelope))
        const title = envelope.title ?? fallbackTitle ?? envelope.url
        return addBytes(bytes, 'application/json', 'youtube', title, envelope.url)
      }

      if (youtube === null) {
        const page = await resolveFetchWebPage(url)
        const envelope: WebPageEnvelope = {
          url: page.url,
          fetchedAt: page.fetchedAt,
          html: page.html,
          rendered: page.rendered,
        }
        const bytes = new TextEncoder().encode(JSON.stringify(envelope))
        const title = titleFromHtml(page.html) ?? page.url
        const source = await addBytes(bytes, 'application/json', 'web', title, page.url)
        return { sources: [source], truncated: false }
      }

      if (youtube.kind === 'playlist') {
        const { videos, truncated } = await resolveFetchYouTubePlaylist(youtube.playlistId)
        if (videos.length === 0) throw new EmptyYouTubePlaylistError(youtube.playlistId)
        const sources: Source[] = []
        for (const [playlistIndex, video] of videos.entries()) {
          sources.push(
            await addYouTubeVideo(video.videoId, video.title, {
              playlistId: youtube.playlistId,
              playlistIndex,
            }),
          )
        }
        return { sources, truncated }
      }

      return { sources: [await addYouTubeVideo(youtube.videoId)], truncated: false }
    },

    retry: async (sourceId) => {
      const source = await repos.sources.findById(sourceId)
      if (source === undefined) throw new Error(`No source ${sourceId}`)
      if (source.blobSha256 === null) {
        throw new Error(`Source ${sourceId} has no stored file to re-parse`)
      }
      const reset = await repos.sources.update(sourceId, { status: 'pending', error: null })
      await enqueueParse(reset)
      return reset
    },

    list: async (options) => {
      const statuses = options?.statuses
      if (statuses === undefined || statuses.length === 0) return repos.sources.list(options)
      if (statuses.length === 1) {
        // biome-ignore lint/style/noNonNullAssertion: length just checked
        return repos.sources.listByStatus(statuses[0]!, options)
      }
      // `SourceRepository` only filters by one status at a time; more than one is rare
      // enough (a handful of sources, not thousands) that filtering in memory here beats
      // the complexity of a multi-status repository query.
      const all = await repos.sources.list(options)
      return all.filter((source) => statuses.includes(source.status))
    },

    get: (id) => repos.sources.findById(id),

    getDoc: async (id) => loadDoc(await repos.sources.findById(id)),

    getChunks: (id) => repos.chunks.listBySource(id),

    getUnits: (id) => repos.sources.listUnits(id),

    estimateContextualization: async (id) => {
      const { estimateContextualization: estimate } = await import('@retenia/ingest/contextualize')
      const { system } = await contextualizePrompt()
      const chunks = await repos.chunks.listBySource(id)
      const source = await repos.sources.findById(id)

      return estimate(
        chunks.filter((chunk) => chunk.context === null),
        { systemPrompt: system, document: await describeChunked(source, chunks) },
      )
    },

    contextualize: async (id, options = {}) => {
      if (textGenerator === undefined) throw new ContextualizationUnavailableError()
      const { contextualizeChunks } = await import('@retenia/ingest/contextualize')
      const { template, version } = await contextualizePrompt()

      const chunks = await repos.chunks.listBySource(id)
      const pending = chunks.filter((chunk) => chunk.context === null)
      if (pending.length === 0) return { written: 0, failed: 0 }

      const source = await repos.sources.findById(id)
      const run = await contextualizeChunks(
        // The pass reads the chunker's own draft shape; a stored row carries every field of it
        // that matters here, and re-deriving the drafts would mean re-chunking the book.
        pending.map((chunk) => ({
          key: chunk.chunkKey ?? chunk.hash,
          text: chunk.text,
          headingPath: chunk.headingPath,
          locator: { block_ids: [], ...chunk.locator },
        })),
        {
          textGenerator,
          promptTemplate: template,
          document: await describeChunked(source, chunks),
          sourceId: id,
          promptVersion: version,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
        },
      )

      const written = await repos.chunks.setContexts(id, run.contexts)
      return { written, failed: run.failures.length }
    },

    rechunkStaleSources: async (tokenizer) => {
      // The `/chunking` slice, not the package barrel: the barrel is the parser stack —
      // pdfjs, tesseract, mammoth, the embedding providers — and every one of them would be
      // loaded here to read a version string out of a pure function.
      const { chunkingVersion } = await import('@retenia/ingest/chunking')
      const version = chunkingVersion({
        id: tokenizer ?? 'chars4',
        // The counter is never called here — `chunkingVersion` only reads the id — so there
        // is no reason to load a tokenizer's rank table just to name it.
        count: () => 0,
      })
      // Two populations, and the second is the one that is easy to miss: sources whose chunks
      // were cut under old rules, *and* sources with no chunks at all — one whose chunk job
      // failed, or anything ingested before this sub-phase existed. A sweep that only looked at
      // chunk rows would leave a whole pre-existing library permanently unsearchable.
      const stale = new Set(await repos.chunks.sourceIdsNeedingRechunk(version))
      const withChunks = new Set(await repos.chunks.sourceIdsWithChunks())
      for (const source of await repos.sources.listByStatus('ready')) {
        if (!withChunks.has(source.id)) stale.add(source.id)
      }

      const queued: string[] = []
      for (const sourceId of stale) {
        const sha256 = sourceDocBlobOf(await repos.sources.findById(sourceId))
        // A source with no parsed document cannot be re-chunked; it needs a re-parse first,
        // which is the user's "retry" and not this sweep's business.
        if (sha256 === undefined) continue
        await enqueueChunk(sourceId, sha256, tokenizer)
        queued.push(sourceId)
      }
      return queued
    },

    /**
     * A card from a range of a recording, rather than from a chunk.
     *
     * `createCardFromChunk` cannot serve this: a chunk is a 60–90 s window the chunker chose,
     * and a range the learner dragged over the transcript almost never coincides with one.
     * The provenance is the same shape either way — a source plus a locator — so the card is
     * as citable as any other; it simply names a time span instead of a chunk id.
     *
     * `annotationId` stays null. `ANNOTATION_KINDS` has a `clip` member and no repository
     * behind it yet, and half-building one here to store a row nothing reads would be worse
     * than saying plainly that clips become cards and not annotations until sub-phase 6.6.
     */
    createCardFromClip: async ({ sourceId, startSec, endSec, front, back }) => {
      const source = await repos.sources.findById(sourceId)
      if (source === undefined) throw new Error(`No source ${sourceId}`)

      const tStartMs = Math.max(0, Math.round(startSec * 1_000))
      const tEndMs = Math.max(tStartMs, Math.round(endSec * 1_000))
      const label = timeLabel(tStartMs)
      const text = (back ?? '').trim()

      return repos.transaction(async (tx) => {
        const item = await tx.knowledgeItems.create({
          lessonId: null,
          topicId: null,
          kind: 'fact',
          fields: {
            // The front is the learner's question. A card whose front is a passage and whose
            // back is the same passage tests nothing (`docs/spec/01-decisions.md` §7), so the
            // fallback is the source and the timestamp — a prompt, not an answer.
            front: front ?? `${source.title} — ${label}`,
            back: text.length > 0 ? text : label,
          },
          sourceId,
          annotationId: null,
          locator: { tStartMs, tEndMs, label, blockIds: [] },
          asOf: null,
          importance: 'normal',
          status: 'active',
          createdBy: 'user',
          tags: [],
        })

        const card = await tx.cards.create({
          itemId: item.id,
          template: 'basic',
          payload: null,
          due: new Date(),
          stability: 0,
          difficulty: 0,
          scheduledDays: 0,
          learningSteps: 0,
          reps: 0,
          lapses: 0,
          state: CARD_STATE.New,
          lastReview: null,
          suspended: false,
          buriedUntil: null,
          leech: false,
          importanceOverride: null,
          importanceOverrideExpiresAt: null,
          examId: null,
        })

        return { itemId: item.id, cardId: card.id }
      })
    },

    createCardFromChunk: async ({ chunkId, front, back }) => {
      const chunk = await repos.chunks.findById(chunkId)
      if (chunk === undefined) throw new Error(`No chunk ${chunkId}`)

      const { parseSourceLocator } = await import('@retenia/core')
      const locator = parseSourceLocator(chunk)

      // One transaction: an item with no card is a row nothing will ever show the user, and
      // a card with no item cannot be rendered at all.
      return repos.transaction(async (tx) => {
        const item = await tx.knowledgeItems.create({
          lessonId: null,
          topicId: null,
          kind: 'fact',
          fields: {
            front: front ?? chunk.headingPath ?? chunk.text.slice(0, CARD_FRONT_FALLBACK_CHARS),
            back: back ?? chunk.text,
          },
          sourceId: chunk.sourceId,
          annotationId: null,
          locator: buildItemLocatorFromChunk(chunk.id, locator),
          asOf: null,
          importance: 'normal',
          status: 'active',
          createdBy: 'user',
          tags: [],
        })

        // A genuinely new card: `state = New`, due now, with the FSRS fields at the zeros
        // `ts-fsrs` starts from. The scheduler introduces it on the next session.
        const card = await tx.cards.create({
          itemId: item.id,
          template: 'basic',
          payload: null,
          due: new Date(),
          stability: 0,
          difficulty: 0,
          scheduledDays: 0,
          learningSteps: 0,
          reps: 0,
          lapses: 0,
          state: CARD_STATE.New,
          lastReview: null,
          suspended: false,
          buriedUntil: null,
          leech: false,
          importanceOverride: null,
          importanceOverrideExpiresAt: null,
          examId: null,
        })

        return { itemId: item.id, cardId: card.id }
      })
    },

    remove: async (id) => {
      await repos.sources.softDelete(id)
    },

    listAnnotations: (sourceId) => repos.annotations.listBySource(sourceId),

    createAnnotation: ({ sourceId, unitId, kind, anchor, quote, note, color }) =>
      repos.annotations.create({
        sourceId,
        unitId: unitId ?? null,
        kind,
        anchor,
        quote: quote ?? null,
        note: note ?? null,
        color: color ?? null,
        tStart: null,
        tEnd: null,
      }),

    updateAnnotation: ({ id, note, color }) =>
      repos.annotations.update(id, {
        ...(note === undefined ? {} : { note }),
        ...(color === undefined ? {} : { color }),
      }),

    deleteAnnotation: async (id) => {
      await repos.annotations.softDelete(id)
    },

    createCardFromAnnotation: async ({ annotationId, front, back }) => {
      const annotation = await repos.annotations.findById(annotationId)
      if (annotation === undefined) throw new Error(`No annotation ${annotationId}`)
      const source = await repos.sources.findById(annotation.sourceId)
      const text = (back ?? annotation.quote ?? '').trim()

      // One transaction: an item with no card is a row nothing will ever show the user, and a
      // card with no item cannot be rendered at all (same invariant `createCardFromChunk` and
      // `createCardFromClip` keep).
      return repos.transaction(async (tx) => {
        const item = await tx.knowledgeItems.create({
          lessonId: null,
          topicId: null,
          kind: 'fact',
          fields: {
            // The front is the learner's question. A card whose front is a passage and whose
            // back is the same passage tests nothing (`docs/spec/01-decisions.md` §7), so the
            // fallback is the source's title rather than the highlighted text itself.
            front: front ?? source?.title ?? 'Cita',
            back: text.length > 0 ? text : (annotation.quote ?? ''),
          },
          sourceId: annotation.sourceId,
          annotationId: annotation.id,
          locator: annotationLocatorOf(annotation),
          asOf: null,
          importance: 'normal',
          status: 'active',
          createdBy: 'user',
          tags: [],
        })

        const card = await tx.cards.create({
          itemId: item.id,
          template: 'basic',
          payload: null,
          due: new Date(),
          stability: 0,
          difficulty: 0,
          scheduledDays: 0,
          learningSteps: 0,
          reps: 0,
          lapses: 0,
          state: CARD_STATE.New,
          lastReview: null,
          suspended: false,
          buriedUntil: null,
          leech: false,
          importanceOverride: null,
          importanceOverrideExpiresAt: null,
          examId: null,
        })

        return { itemId: item.id, cardId: card.id }
      })
    },

    recordProgress: async (sourceId, locator) => {
      await repos.sources.recordProgress(sourceId, locator, new Date())
    },

    listRecentlyOpened: (limit) => repos.sources.listRecentlyOpened(limit ?? 10),

    onJobSettled: async (job) => {
      if (job.subjectId === null) return
      if (job.kind === PARSE_JOB_KIND) return onParseSettled(job, job.subjectId)
      if (job.kind === CHUNK_JOB_KIND) return onChunkSettled(job, job.subjectId)
    },
  }

  async function onParseSettled(job: Job, sourceId: string): Promise<void> {
    if (job.status === 'succeeded' && job.result !== null) {
      const result = job.result as unknown as IngestParseResult
      const existing = await repos.sources.findById(sourceId)
      const meta: JsonObject = {
        ...existing?.meta,
        sourceDocBlobSha256: result.sourceDocBlobSha256,
        blockCount: result.blockCount,
        assetCount: result.assetCount,
        needsOcr: result.needsOcr,
        ocrPages: result.ocrPages,
        warnings: result.warnings,
        // Sub-phase 6.4.
        ...(result.media === undefined ? {} : { media: result.media as unknown as JsonObject }),
        // Sub-phase 6.5.
        ...(result.origin === undefined ? {} : { origin: result.origin as unknown as JsonObject }),
      }
      // The job's part list supersedes the one written at import — it is the one carrying real
      // durations and timeline offsets — so the import-time copy is dropped rather than left
      // beside it to be read by mistake. `delete` rather than `undefined`, because a JSON
      // column has no way to spell "present but undefined".
      if (result.media !== undefined) delete meta.mediaParts
      await repos.sources.update(sourceId, { language: result.language, meta })
      // Chunking is queued *before* the source is marked ready, so nothing can observe a
      // `ready` source that has no chunks and conclude the document is empty.
      await enqueueChunk(sourceId, result.sourceDocBlobSha256)
      await repos.sources.markIngested(sourceId, new Date())
      return
    }

    if (job.status === 'failed' || job.status === 'cancelled') {
      await repos.sources.markFailed(sourceId, job.error ?? 'Parsing failed')
    }
  }

  async function onChunkSettled(job: Job, sourceId: string): Promise<void> {
    if (job.status === 'succeeded' && job.result !== null) {
      const result = job.result as unknown as IngestChunkResult
      const bytes = await blobStore.get(result.chunkDraftsBlobSha256, 'json')
      const drafts = JSON.parse(new TextDecoder().decode(bytes)) as ChunkDraftsBlob
      await persistChunkDrafts(repos, drafts)

      const existing = await repos.sources.findById(sourceId)
      const meta: JsonObject = {
        ...existing?.meta,
        chunkCount: result.chunkCount,
        unitCount: result.unitCount,
        frontmatterChunkCount: result.frontmatterCount,
        chunkTokenCount: result.tokenCount,
        chunkingVersion: result.chunkingVersion,
      }
      await repos.sources.update(sourceId, { meta })
      // Chunking done is retrieval not yet done: without this, a freshly imported source (or
      // one just re-chunked) sat "ready" with real chunks and no vectors until the *next app
      // start*'s reindex sweep noticed — the only other caller of `embedSource` — so hybrid
      // search silently answered from BM25 alone for the rest of the session. Left to
      // propagate to the runner's own `onSettled` handler on failure (`jobs/runner.ts`
      // already logs and does not crash the queue over it), the same as everything else in
      // this function: retrying is what the next reindex sweep or a manual re-embed is for.
      await embedSource?.(sourceId)
      return
    }

    if (job.status === 'failed' || job.status === 'cancelled') {
      // Deliberately *not* `markFailed`: the parse succeeded, the text is readable and the
      // source is usable in the reader. What is missing is retrieval, which the reindex sweep
      // picks up on the next start because the chunks were never written.
      await repos.sources.update(sourceId, {
        error: `Chunking failed: ${job.error ?? 'unknown error'}`,
      })
    }
  }
}
