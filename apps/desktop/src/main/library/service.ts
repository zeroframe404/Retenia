import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { TextGenerator } from '@retenia/ai'
import type {
  AbortSignalLike,
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
import type { ChunkDraftsBlob, IngestChunkResult } from '../../jobs/ingest-chunk'
import type { IngestParseResult } from '../../jobs/ingest-parse'
import { persistChunkDrafts } from './chunk-store'
import { detectSource } from './detect-kind'

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
  addFromText(text: string, title: string): Promise<Source>
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
  createCardFromChunk(input: {
    chunkId: string
    front?: string
    back?: string
  }): Promise<{ itemId: string; cardId: string }>
  remove(id: string): Promise<void>
  /** Wired into `createJobRunner`'s `onSettled`; a no-op for any job that is not one of ours. */
  onJobSettled(job: Job): Promise<void>
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
}

/** Thrown by `contextualize` when there is no provider to ask. Its own class so the IPC layer
 *  can turn it into "not configured yet" rather than an unexplained failure. */
export class ContextualizationUnavailableError extends Error {
  constructor() {
    super('No AI provider is configured for the "cheap" role yet')
    this.name = 'ContextualizationUnavailableError'
  }
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

export function createLibraryService({
  repos,
  blobStore,
  scheduler,
  textGenerator,
}: LibraryServiceOptions): LibraryService {
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
    const { systemFromTemplate } = await import('@retenia/ingest')
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
    const { buildOutlineFromHeadingPaths, describeDocument } = await import('@retenia/ingest')
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

  const addBytes = async (
    bytes: Uint8Array,
    mime: string,
    kind: Source['kind'],
    title: string,
    originUri: string | null,
  ): Promise<Source> => {
    const put = await blobStore.put(bytes, mime)
    const source = await repos.sources.create({
      kind,
      title,
      originUri,
      blobSha256: put.sha256,
      status: 'pending',
      language: null,
      meta: { blobExt: put.ext },
      error: null,
      ingestedAt: null,
      embeddingStatus: 'pending',
      embeddingModelId: null,
      embeddingError: null,
    })
    await enqueueParse(source)
    return source
  }

  return {
    addFromFile: async (path, originalName) => {
      const name = originalName ?? basename(path)
      const { kind, mime } = detectSource(name)
      const bytes = await readFile(path)
      return addBytes(new Uint8Array(bytes), mime, kind, name, `file://${path}`)
    },

    addFromBytes: async (name, bytes) => {
      const { kind, mime } = detectSource(name)
      return addBytes(bytes, mime, kind, name, null)
    },

    addFromText: async (text, title) =>
      addBytes(new TextEncoder().encode(text), 'text/plain', 'text', title, null),

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
      const { estimateContextualization: estimate } = await import('@retenia/ingest')
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
      const { contextualizeChunks } = await import('@retenia/ingest')
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
      const { chunkingVersion } = await import('@retenia/ingest')
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
          // The provenance that makes the card citable: page or timestamp, and the exact
          // blocks it covers.
          locator: {
            chunkId: chunk.id,
            ...(locator.page === null ? {} : { page: locator.page }),
            ...(locator.label === null ? {} : { label: locator.label }),
            ...(locator.tStartMs === null ? {} : { tStartMs: locator.tStartMs }),
            blockIds: [...locator.blockIds],
          },
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
      }
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
